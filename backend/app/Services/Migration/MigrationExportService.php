<?php

namespace App\Services\Migration;

use App\Models\MigrationExport;
use App\Services\ShellService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use RuntimeException;

/**
 * Source side: packs the whole server into one encrypted archive for the new panel to pull.
 */
class MigrationExportService
{
    public function __construct(private ShellService $shell) {}

    public function create(MigrationExport $export, string $passphrase): void
    {
        $export->update(['status' => 'running', 'started_at' => now()]);

        $staging = config('hosting.backup_path') . '/.staging';
        if (!is_dir($staging) && !@mkdir($staging, 0750, true)) {
            throw new RuntimeException("Directory {$staging} is missing - re-run install.sh");
        }

        $dbCopy = "{$staging}/panel-{$export->id}.sqlite";
        $passFile = "{$staging}/pass-{$export->id}";

        try {
            $export->appendLog('==> Snapshotting panel database');
            @unlink($dbCopy);
            DB::statement('VACUUM INTO ?', [$dbCopy]);
            $this->scrubSnapshot($dbCopy);

            // The helper reads the passphrase from stdin so it never appears in a process list
            file_put_contents($passFile, $passphrase);
            chmod($passFile, 0600);

            $command = 'sudo ' . config('hosting.backup_helper') . ' create ' . (int) $export->id . ' '
                . escapeshellarg($dbCopy) . ' < ' . escapeshellarg($passFile);

            $output = '';
            $exitCode = $this->shell->stream($command, '/', function ($buffer) use ($export, &$output) {
                $output .= $buffer;
                $export->appendLog(rtrim($buffer));
            }, 7000);

            if ($exitCode !== 0) {
                throw new RuntimeException("Packing the server failed (helper exited with code {$exitCode})");
            }

            $result = $this->parseResult($output);
        } finally {
            @unlink($dbCopy);
            @unlink($passFile);
        }

        $export->update([
            'filename' => basename($result['FILE']),
            'local_path' => $result['FILE'],
            'size_bytes' => (int) $result['SIZE'],
            'sha256' => $result['SHA256'],
            'status' => 'completed',
            'finished_at' => now(),
        ]);

        // Switched off (or key revoked) while packing: the archive must not stay around
        if (!MigrationSwitch::isOn() || !MigrationKey::active()) {
            $this->discard($export, 'expired');
            $export->markFailed('Migration was turned off while packing - the archive was destroyed.');
            return;
        }
        $export->appendLog('==> Server packed and encrypted, ready for transfer');
    }

    /**
     * After a successful transfer the archive (all server data) must not linger on disk.
     */
    public function discard(MigrationExport $export, string $status): void
    {
        if ($export->local_path) {
            File::delete($export->local_path);
        }
        $export->update(['status' => $status, 'local_path' => null]);
    }

    /**
     * The new server must not inherit this server's migration key, switch or history:
     * it starts with migration OFF.
     */
    private function scrubSnapshot(string $dbCopy): void
    {
        $copy = new \PDO('sqlite:' . $dbCopy);
        $copy->exec("DELETE FROM settings WHERE key LIKE 'migration\\_key\\_%' ESCAPE '\\'");
        $copy->exec("DELETE FROM settings WHERE key = '" . MigrationSwitch::SETTING . "'");
        $copy->exec('DELETE FROM migration_exports');
        $copy->exec('DELETE FROM migration_events');
        $copy = null;
    }

    private function parseResult(string $output): array
    {
        preg_match_all('/^RESULT_(FILE|SIZE|SHA256)=(.+)$/m', $output, $matches, PREG_SET_ORDER);
        $result = [];
        foreach ($matches as [, $key, $value]) {
            $result[$key] = trim($value);
        }

        if (count($result) !== 3 || !str_starts_with($result['FILE'], config('hosting.backup_path') . '/')) {
            throw new RuntimeException('The helper did not report a valid archive.');
        }

        return $result;
    }
}
