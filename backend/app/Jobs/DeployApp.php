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

    public $timeout = 1200; // 20 minutes

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
}
