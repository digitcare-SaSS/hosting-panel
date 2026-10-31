<?php

namespace App\Jobs;

use App\Models\App;
use App\Models\Deployment;
use App\Services\DeploymentService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class DeployApp implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $timeout = 3600; // 1 hour: must cover git + install + build step timeouts, or the worker is killed mid-deploy
    public $tries = 1; // A deploy killed mid-way must not silently re-run hours later (retry_after)

    public function __construct(
        protected App $app,
        protected Deployment $deployment,
        protected bool $zeroDowntime = false
    ) {}

    public function handle(DeploymentService $deploymentService): void
    {
        try {
            $deploymentService->runDeployment($this->app, $this->deployment, $this->zeroDowntime);
        } catch (\Throwable $e) {
            Log::error('Background Deployment Failed', [
                'app_id' => $this->app->id,
                'deployment_id' => $this->deployment->id,
                'error' => $e->getMessage()
            ]);

            $this->deployment->update(['status' => 'failed', 'finished_at' => now()]);
            $this->deployment->appendLog("\n[ERROR] " . $e->getMessage());
            // runDeployment already set the app status; a failed zero-downtime deploy keeps the old version running
            if (!$this->zeroDowntime) {
                $this->app->update(['status' => 'error']);
            }

            $this->fail($e);
        }
    }

    /**
     * Also runs when the worker kills the job on timeout, where handle()'s catch never runs.
     */
    public function failed(?\Throwable $e): void
    {
        $this->deployment->refresh();
        if ($this->deployment->status !== 'deploying') {
            return;
        }

        $this->deployment->update(['status' => 'failed', 'finished_at' => now()]);
        $this->deployment->appendLog("\n[ERROR] " . ($e?->getMessage() ?? 'The deployment was stopped by the queue worker'));
        if (!$this->zeroDowntime) {
            $this->app->update(['status' => 'error']);
        }
    }
}
