<?php

namespace App\Services;

use App\Models\App;
use App\Models\AppService;

/**
 * Manages background service processes for apps via systemd.
 *
 * Each service runs as a systemd unit: svc-{app_id}-{service_id}.service
 * Unit files are written to /etc/systemd/system/ via sudo.
 * journalctl is used for log streaming.
 *
 * Required sudoers (add to /etc/sudoers.d/www-data-services):
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl start svc-*
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl stop svc-*
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl restart svc-*
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl enable svc-*
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl disable svc-*
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
 *   www-data ALL=(ALL) NOPASSWD: /bin/systemctl is-active svc-*
 *   www-data ALL=(ALL) NOPASSWD: /usr/bin/tee /etc/systemd/system/svc-*
 *   www-data ALL=(ALL) NOPASSWD: /bin/rm -f /etc/systemd/system/svc-*
 *   www-data ALL=(ALL) NOPASSWD: /usr/bin/journalctl -u svc-* *
 */
class BackgroundServiceManager
{
    public function __construct(private ShellService $shell) {}

    // ─── Recommended services per app type ───────────────────────────────────

    /**
     * Returns recommended service definitions for the given app type.
     */
    public static function recommendedFor(string $appType): array
    {
        return match ($appType) {
            'laravel' => [
                [
                    'name'        => 'Queue Worker',
                    'slug'        => 'queue-worker',
                    'type'        => 'php-worker',
                    'command'     => 'php artisan queue:work --sleep=3 --tries=3 --max-time=3600',
                    'description' => 'Processes queued jobs (emails, notifications, etc.)',
                    'recommended' => true,
                ],
                [
                    'name'        => 'Schedule Runner',
                    'slug'        => 'scheduler',
                    'type'        => 'php-worker',
                    'command'     => 'php artisan schedule:work',
                    'description' => 'Runs the Laravel task scheduler every minute',
                    'recommended' => true,
                ],
                [
                    'name'        => 'Horizon (Queue Dashboard)',
                    'slug'        => 'horizon',
                    'type'        => 'php-worker',
                    'command'     => 'php artisan horizon',
                    'description' => 'Redis-based queue monitoring dashboard (requires Horizon package)',
                    'recommended' => false,
                ],
            ],
            'nextjs' => [
                [
                    'name'        => 'Next.js App Server',
                    'slug'        => 'nextjs-server',
                    'type'        => 'node-worker',
                    'command'     => 'npm run start',
                    'description' => 'The primary Next.js production process',
                    'recommended' => true,
                ],
            ],
            default => [],
        };
    }

    // ─── systemd helpers ─────────────────────────────────────────────────────

    private function unitName(AppService $service): string
    {
        return "svc-{$service->app_id}-{$service->id}";
    }

    private function unitFilePath(AppService $service): string
    {
        return '/etc/systemd/system/' . $this->unitName($service) . '.service';
    }

    /**
     * Build the systemd [Unit] / [Service] / [Install] file content.
     */
    private function buildUnitFile(AppService $service): string
    {
        $app         = $service->app;
        $workingDir  = $app->deploy_path;
        $command     = $service->command;
        $description = $service->description ?: $service->name;
        $unitName    = $this->unitName($service);

        // Resolve the executable correctly ─ prepend PHP / Node path if needed
        $execStart = $this->resolveExecStart($command, $workingDir);

        return <<<INI
[Unit]
Description={$description} (App: {$app->name})
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory={$workingDir}
ExecStart={$execStart}
Restart=always
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier={$unitName}
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
INI;
    }

    /**
     * Prefix artisan / npm / node commands with their full paths so systemd
     * (which has a minimal PATH) can find them.
     */
    private function resolveExecStart(string $command, string $cwd): string
    {
        $phpBin  = trim(shell_exec('which php') ?: '/usr/bin/php');
        $npmBin  = trim(shell_exec('which npm') ?: '/usr/bin/npm');
        $nodeBin = trim(shell_exec('which node') ?: '/usr/bin/node');

        // php artisan ...
        if (str_starts_with($command, 'php ')) {
            return $phpBin . ' ' . ltrim(substr($command, 3));
        }
        // npm run ...
        if (str_starts_with($command, 'npm ')) {
            return $npmBin . ' ' . ltrim(substr($command, 3));
        }
        // node ...
        if (str_starts_with($command, 'node ')) {
            return $nodeBin . ' ' . ltrim(substr($command, 4));
        }
        return $command;
    }

    /**
     * Write the unit file and reload the daemon.
     */
    private function writeUnitFile(AppService $service): array
    {
        $content  = $this->buildUnitFile($service);
        $path     = $this->unitFilePath($service);
        $escaped  = escapeshellarg($content);

        $result = $this->shell->run("echo {$escaped} | sudo tee {$path} > /dev/null");
        if ($result['exit_code'] !== 0) {
            return $result;
        }

        return $this->shell->run("sudo systemctl daemon-reload");
    }

    /**
     * Remove the unit file and reload daemon (called on delete).
     */
    private function removeUnitFile(AppService $service): void
    {
        $path = $this->unitFilePath($service);
        $this->shell->run("sudo rm -f {$path}");
        $this->shell->run("sudo systemctl daemon-reload");
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    public function start(AppService $service): array
    {
        if (!$service->app->deploy_path) {
            return ['exit_code' => 1, 'output' => 'App has not been deployed yet.'];
        }

        // Write / update unit file first
        $write = $this->writeUnitFile($service);
        if ($write['exit_code'] !== 0) {
            return ['exit_code' => 1, 'output' => 'Failed to write systemd unit: ' . $write['output']];
        }

        // Enable + start
        $unitName = $this->unitName($service);
        $this->shell->run("sudo systemctl enable {$unitName}");
        $result = $this->shell->run("sudo systemctl start {$unitName}");

        $status = $result['exit_code'] === 0 ? 'running' : 'failed';
        $service->update([
            'status'     => $status,
            'started_at' => $result['exit_code'] === 0 ? now() : null,
        ]);

        return $result;
    }

    public function stop(AppService $service): array
    {
        $unitName = $this->unitName($service);
        $result   = $this->shell->run("sudo systemctl stop {$unitName}");

        $service->update(['status' => $result['exit_code'] === 0 ? 'stopped' : 'failed']);
        return $result;
    }

    public function restart(AppService $service): array
    {
        if (!$service->app->deploy_path) {
            return ['exit_code' => 1, 'output' => 'App has not been deployed yet.'];
        }

        // Refresh unit file in case command changed
        $this->writeUnitFile($service);

        $unitName = $this->unitName($service);
        $result   = $this->shell->run("sudo systemctl restart {$unitName}");

        $status = $result['exit_code'] === 0 ? 'running' : 'failed';
        $service->update(['status' => $status]);
        return $result;
    }

    public function delete(AppService $service): void
    {
        $unitName = $this->unitName($service);
        $this->shell->run("sudo systemctl stop {$unitName} 2>/dev/null; true");
        $this->shell->run("sudo systemctl disable {$unitName} 2>/dev/null; true");
        $this->removeUnitFile($service);
    }

    /**
     * Fetch journal logs for the service.
     */
    public function logs(AppService $service, int $lines = 150): string
    {
        $unitName = $this->unitName($service);
        // journalctl needs sudo to read system journals for www-data unit
        $result = $this->shell->run("sudo journalctl -u {$unitName} --no-pager -n {$lines} --output=short-iso 2>&1");
        return $result['output'] ?: '(no journal logs yet — service may not have started)';
    }

    /**
     * Sync live systemd status into DB records for the app's services.
     */
    public function syncStatus(App $app): void
    {
        foreach ($app->services as $service) {
            $unitName = $this->unitName($service);
            $result   = $this->shell->run("sudo systemctl is-active {$unitName} 2>/dev/null");
            $state    = trim($result['output']);

            $status = match ($state) {
                'active'     => 'running',
                'inactive'   => 'stopped',
                'failed'     => 'failed',
                'activating' => 'running',
                default      => 'unknown',
            };

            if ($service->status !== $status) {
                $service->update(['status' => $status]);
            }
        }
    }

    /**
     * Install recommended services for the app type (idempotent, does not start them).
     */
    public function installRecommended(App $app): void
    {
        foreach (self::recommendedFor($app->type) as $rec) {
            if (!$app->services()->where('slug', $rec['slug'])->exists()) {
                $app->services()->create([
                    'name'        => $rec['name'],
                    'slug'        => $rec['slug'],
                    'type'        => $rec['type'],
                    'command'     => $rec['command'],
                    'description' => $rec['description'],
                    'recommended' => $rec['recommended'],
                    'enabled'     => true,
                    'status'      => 'stopped',
                ]);
            }
        }
    }
}
