<?php

namespace App\Services;

use App\Models\App;

class PM2Service
{
    public function __construct(private ShellService $shell) {}

    public function start(App $app): array
    {
        return $this->startProcess($app->pm2Name(), $app->runtimePath(), $app->port);
    }

    public function startProcess(string $name, string $path, int $port): array
    {
        // Next.js uses `npm run start` bound to specific port
        $command = "PORT={$port} pm2 start npm --name \"{$name}\" -- run start";
        return $this->shell->run($command, $path);
    }

    public function stop(App $app): array
    {
        return $this->shell->run("pm2 stop \"{$app->pm2Name()}\"");
    }

    public function restart(App $app): array
    {
        return $this->shell->run("pm2 restart \"{$app->pm2Name()}\"");
    }

    public function delete(App $app): array
    {
        return $this->deleteProcess($app->pm2Name());
    }

    public function deleteProcess(string $name): array
    {
        return $this->shell->run("pm2 delete \"{$name}\"");
    }

    /**
     * Remove the classic process and both blue/green slot processes.
     */
    public function deleteAll(App $app): void
    {
        foreach ([null, 'blue', 'green'] as $slot) {
            $this->deleteProcess($app->processName($slot));
        }
    }

    public function status(App $app): string
    {
        $result = $this->shell->run("pm2 jlist");
        if ($result['exit_code'] !== 0) {
            return 'unknown';
        }

        $processes = json_decode($result['output'], true) ?? [];
        foreach ($processes as $proc) {
            if ($proc['name'] === $app->pm2Name()) {
                return $proc['pm2_env']['status'] ?? 'unknown';
            }
        }
        return 'stopped';
    }

    public function logs(App $app, int $lines = 100): string
    {
        return $this->processLogs($app->pm2Name(), $lines);
    }

    public function processLogs(string $name, int $lines = 100): string
    {
        $result = $this->shell->run("pm2 logs \"{$name}\" --nostream --lines {$lines}");
        return $result['output'];
    }

    public function save(): void
    {
        $this->shell->run("pm2 save");
    }
}
