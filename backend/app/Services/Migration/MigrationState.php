<?php

namespace App\Services\Migration;

/**
 * Target-side progress of an incoming migration.
 *
 * Kept in files rather than the panel database: the restore replaces the database (and the
 * admin's login) mid-way, and the browser must keep following progress through that.
 */
class MigrationState
{
    public function dir(): string
    {
        return config('hosting.backup_path') . '/migration';
    }

    public function archivePath(string $filename): string
    {
        return $this->dir() . '/' . $filename;
    }

    /**
     * Start a new migration. Returns the progress token the browser polls with.
     */
    public function begin(array $source): string
    {
        if (!is_dir($this->dir())) {
            @mkdir($this->dir(), 0750, true);
        }
        // Leftovers from an earlier attempt (archives contain every secret of the old server)
        foreach (glob($this->dir() . '/*') ?: [] as $file) {
            @unlink($file);
        }

        $token = bin2hex(random_bytes(24));
        $this->write([
            'token_hash' => hash('sha256', $token),
            'status' => 'running',
            'phase' => 'connecting',
            'source' => $source,
            'bytes_done' => 0,
            'bytes_total' => null,
            'error' => null,
            'started_at' => now()->toIso8601String(),
        ]);
        file_put_contents($this->logPath(), '');

        return $token;
    }

    public function read(): ?array
    {
        $raw = @file_get_contents($this->statePath());
        $state = $raw ? json_decode($raw, true) : null;

        return is_array($state) ? $state : null;
    }

    public function update(array $changes): void
    {
        $this->write(array_merge($this->read() ?? [], $changes, ['updated_at' => now()->toIso8601String()]));
    }

    public function log(string $line): void
    {
        file_put_contents($this->logPath(), rtrim($line, "\n") . "\n", FILE_APPEND);
    }

    public function fail(string $message): void
    {
        $this->log("[ERROR] {$message}");
        $this->update(['status' => 'failed', 'error' => $message]);
    }

    public function isRunning(): bool
    {
        $progress = $this->progress();

        return $progress !== null && in_array($progress['status'], ['running', 'restoring'], true);
    }

    public function tokenMatches(string $token): bool
    {
        $state = $this->read();

        return $state !== null && hash_equals($state['token_hash'], hash('sha256', $token));
    }

    /**
     * Everything the progress screen shows, merged with the root restore's own status/log.
     */
    public function progress(): ?array
    {
        $state = $this->read();
        if ($state === null) {
            return null;
        }

        $log = (string) @file_get_contents($this->logPath());

        if ($state['status'] === 'restoring') {
            $restoreDir = config('hosting.restore_status_path');
            $restore = json_decode((string) @file_get_contents("{$restoreDir}/status.json"), true) ?: [];
            $log .= (string) @file_get_contents("{$restoreDir}/restore.log");

            if (($restore['state'] ?? null) === 'completed') {
                $state['status'] = 'completed';
                $state['phase'] = 'done';
            } elseif (($restore['state'] ?? null) === 'failed') {
                $state['status'] = 'failed';
                $state['error'] = $restore['message'] ?? 'The restore failed - see the log.';
            }
        }

        unset($state['token_hash']);
        // Tools like PM2 colour their output; the browser shows plain text
        $state['log'] = mb_substr(preg_replace('/\e\[[0-9;?]*[A-Za-z]/', '', $log), -60000);

        return $state;
    }

    private function statePath(): string
    {
        return $this->dir() . '/state.json';
    }

    private function logPath(): string
    {
        return $this->dir() . '/migration.log';
    }

    private function write(array $state): void
    {
        $tmp = $this->statePath() . '.tmp';
        file_put_contents($tmp, json_encode($state, JSON_UNESCAPED_SLASHES));
        rename($tmp, $this->statePath());
    }
}
