<?php

namespace App\Jobs;

use App\Models\Setting;
use App\Services\Migration\MigrationClient;
use App\Services\Migration\MigrationKey;
use App\Services\Migration\MigrationState;
use App\Services\ShellService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Crypt;
use RuntimeException;

/**
 * Target side: pull everything from the old panel and hand the archive to the root restore.
 */
class MigrateFromServer implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public $timeout = 10800; // 3 hours: packing + transferring a large server
    public $tries = 1;

    private const EXPORT_TIMEOUT = 7200;

    /**
     * @param string $encryptedKey the pasted migration key, encrypted with Crypt for the jobs table
     */
    public function __construct(
        protected string $sourceUrl,
        protected string $encryptedKey
    ) {}

    public function handle(MigrationState $state, ShellService $shell): void
    {
        $key = MigrationKey::parse(Crypt::decryptString($this->encryptedKey))->withUrl($this->sourceUrl);
        $client = new MigrationClient($key);

        // 1. The old panel packs and encrypts the whole server
        $state->update(['phase' => 'exporting']);
        $state->log("==> Asking {$key->url} to pack the server");
        $export = $client->startExport();
        $export = $this->waitForExport($client, $state, $export);

        // 2. Pull the encrypted archive (resumes after network drops)
        $state->update(['phase' => 'downloading', 'bytes_total' => $export['size_bytes']]);
        $state->log(sprintf('==> Transferring %s (%.1f MB, encrypted)', $export['filename'], $export['size_bytes'] / 1048576));
        $path = $state->archivePath($export['filename']);
        $client->download($path, $export['size_bytes'], function (int $done) use ($state) {
            $state->update(['bytes_done' => $done]);
        });

        // 3. Verify against the checksum from the old panel's signed status
        $state->update(['phase' => 'verifying']);
        $state->log('==> Verifying the transfer');
        clearstatcache(true, $path);
        if (filesize($path) !== $export['size_bytes'] || !hash_equals($export['sha256'], hash_file('sha256', $path))) {
            @unlink($path);
            throw new RuntimeException('The transferred archive does not match the checksum from the old panel. Start the migration again.');
        }
        $state->log('==> Checksum OK');

        try {
            $client->complete();
            $state->log('==> Old panel deleted its copy of the archive and retired the key');
        } catch (\Throwable $e) {
            $state->log("[WARN] Could not tell the old panel the transfer finished: {$e->getMessage()}");
        }

        // 4. Root restore in its own systemd unit - it restarts this queue worker and php-fpm
        $state->update(['phase' => 'restoring', 'status' => 'restoring']);
        $state->log('==> Restoring on this server (the panel restarts during this step)');
        $this->startRestore($shell, $state, basename($path), $key->archivePassphrase());
    }

    public function failed(?\Throwable $e): void
    {
        app(MigrationState::class)->fail($e?->getMessage() ?? 'The migration failed');
    }

    private function waitForExport(MigrationClient $client, MigrationState $state, array $export): array
    {
        $deadline = time() + self::EXPORT_TIMEOUT;
        $shownLog = 0;

        while (true) {
            $log = (string) ($export['log'] ?? '');
            if (strlen($log) > $shownLog) {
                foreach (explode("\n", rtrim(substr($log, $shownLog))) as $line) {
                    if ($line !== '' && !str_starts_with($line, 'RESULT_')) {
                        $state->log("[old server] {$line}");
                    }
                }
                $shownLog = strlen($log);
            }

            if ($export['status'] === 'completed') {
                return $export;
            }
            if (in_array($export['status'], ['failed', 'transferred'], true)) {
                throw new RuntimeException('The old panel could not pack the server: ' . ($export['error'] ?? $export['status']));
            }
            if (time() > $deadline) {
                throw new RuntimeException('Timed out waiting for the old panel to pack the server.');
            }

            sleep(5);
            $export = $client->exportStatus();
        }
    }

    private function startRestore(ShellService $shell, MigrationState $state, string $filename, string $passphrase): void
    {
        $newIp = Setting::get('server_ip') ?: env('SERVER_IP');
        if (!filter_var($newIp, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            throw new RuntimeException('This server\'s IP is not set (Settings → Nameserver Basics → server IP).');
        }

        // Passphrase goes in on stdin so it never shows up in a process list
        $passFile = config('hosting.backup_path') . '/.staging/restore-pass-' . bin2hex(random_bytes(4));
        file_put_contents($passFile, $passphrase);
        chmod($passFile, 0600);

        try {
            $command = 'sudo ' . config('hosting.backup_helper') . ' restore-start '
                . escapeshellarg($filename) . ' ' . escapeshellarg($newIp) . ' < ' . escapeshellarg($passFile);
            $result = $shell->run($command, '/', 60);
        } finally {
            @unlink($passFile);
        }

        if ($result['exit_code'] !== 0 || !str_contains($result['output'], 'RESTORE_STARTED')) {
            throw new RuntimeException('Could not start the restore: ' . trim($result['output']));
        }
    }
}
