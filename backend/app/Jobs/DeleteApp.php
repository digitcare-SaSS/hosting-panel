<?php

namespace App\Jobs;

use App\Models\App;
use App\Models\Domain;
use App\Services\PM2Service;
use App\Services\NginxConfigService;
use App\Services\DnsService;
use App\Services\DatabaseService;
use App\Services\GitHubService;
use App\Services\EmailService;
use App\Services\SslService;
use App\Services\BackgroundServiceManager;
use App\Models\EmailDomain;
use App\Models\Setting;
use App\Services\ShellService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class DeleteApp implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        protected array $appData
    ) {}

    public function handle(
        PM2Service $pm2Service,
        NginxConfigService $nginxService,
        DnsService $dnsService,
        EmailService $emailService,
        SslService $sslService,
        BackgroundServiceManager $serviceManager
    ): void {
        try {
            // We work with a temporary App model instance since the original might be deleted
            $app = new App($this->appData);
            $app->id = $this->appData['id'];

            Log::info("Starting cleanup for app ID {$app->id} (Name: {$app->name}, Domain: {$app->domain})");

            // 1. SSL Cleanup
            Log::info("Step 1: SSL Cleanup");
            try {
                if (!empty($this->appData['ssl_enabled']) || !empty($this->appData['domain'])) {
                    $sslService->removeSsl($app);
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup SSL failed for app {$app->id}: " . $e->getMessage());
            }

            // 2. PM2 Cleanup (for Next.js)
            Log::info("Step 2: PM2 Cleanup");
            try {
                if ($app->type === 'nextjs') {
                    $pm2Service->deleteAll($app);
                    $pm2Service->save();
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup PM2 failed for app {$app->id}: " . $e->getMessage());
            }

            // 3. Background Services Cleanup
            Log::info("Step 3: Background Services Cleanup");
            try {
                if (!empty($this->appData['services'])) {
                    foreach ($this->appData['services'] as $svcData) {
                        $svc = new \App\Models\AppService($svcData);
                        $svc->id = $svcData['id'];
                        $serviceManager->delete($svc);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup background services failed for app {$app->id}: " . $e->getMessage());
            }

            // 4. Nginx Cleanup
            Log::info("Step 4: Nginx Cleanup");
            try {
                $nginxService->remove($app);
            } catch (\Throwable $e) {
                Log::warning("Cleanup Nginx failed for app {$app->id}: " . $e->getMessage());
            }

            // 5. DNS & Email Cleanup
            Log::info("Step 5: DNS & Email Cleanup (Target domain: " . ($this->appData['domain'] ?? 'none') . ")");
            try {
                // First try to find by snapshotted ID (most reliable as app_id might be nulled)
                $domain = null;
                if (!empty($this->appData['domain_id'])) {
                    $domain = Domain::find($this->appData['domain_id']);
                }

                if ($domain) {
                    Log::info("Found domain by snapshotted ID: {$domain->domain}");
                } else {
                    // Fallback to app_id (just in case)
                    $domain = Domain::where('app_id', $app->id)->first();
                    if ($domain) {
                        Log::info("Found domain by app_id: {$domain->domain}");
                    } else {
                        Log::info("Domain not found by snapshotted ID or app_id, using fallback search by name: " . ($this->appData['domain'] ?? 'N/A'));
                        if (!empty($this->appData['domain'])) {
                            $domain = Domain::where('domain', $this->appData['domain'])->first();
                            if ($domain) {
                                Log::info("Found domain by name: {$domain->domain} (ID: {$domain->id})");
                            } else {
                                Log::warning("Domain record NOT found by name in database.");
                            }
                        }
                    }
                }

                if ($domain) {
                    // Cleanup Email
                    $emailDomain = EmailDomain::where('domain_id', $domain->id)->first();
                    if ($emailDomain) {
                        Log::info("Found email domain for cleanup: {$emailDomain->id}");
                        $emailService->removeDomain($emailDomain);
                        $emailDomain->delete();
                    }

                    Log::info("Removing DNS zone and domain record for: {$domain->domain}");
                    $dnsService->removeZone($domain);
                    $domain->delete();
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup DNS/Email failed for app {$app->id}: " . $e->getMessage());
            }

            // 6. Filesystem Cleanup
            Log::info("Step 6: Filesystem Cleanup");
            try {
                $deployPath = $this->appData['deploy_path'] ?? null;
                if (empty($deployPath) && !empty($this->appData['domain'])) {
                    $basePath = config('hosting.apps_base_path', '/var/www/hosting-apps');
                    $deployPath = "{$basePath}/{$this->appData['domain']}";
                }

                if (!empty($deployPath)) {
                    $fileManager = app(\App\Services\FileManagerService::class);
                    $success = $fileManager->delete($deployPath);
                    if (!$success) {
                        Log::warning("Filesystem cleanup failed for app {$app->id} at path: {$deployPath}");
                    } else {
                        Log::info("Filesystem cleanup successful for path: {$deployPath}");
                    }
                } else {
                    Log::warning("Filesystem cleanup skipped: No deploy_path or domain available.");
                }

                // Blue/green release directories from zero-downtime deploys
                if (!empty($this->appData['domain'])) {
                    $basePath = config('hosting.apps_base_path', '/var/www/hosting-apps');
                    $releasesPath = "{$basePath}/.releases/{$this->appData['domain']}";
                    if (is_dir($releasesPath)) {
                        app(\App\Services\FileManagerService::class)->delete($releasesPath);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup Filesystem failed for app {$app->id}: " . $e->getMessage());
            }

            // 7. Databases Cleanup
            Log::info("Step 7: Databases Cleanup");
            try {
                $dbService = app(DatabaseService::class);
                if (!empty($this->appData['databases'])) {
                    foreach ($this->appData['databases'] as $dbData) {
                        $db = \App\Models\Database::find($dbData['id']);
                        if (!$db) {
                            $db = new \App\Models\Database($dbData);
                            $db->id = $dbData['id'];
                        }
                        $dbService->delete($db);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup Databases failed for app {$app->id}: " . $e->getMessage());
            }

            // 8. GitHub Webhook Cleanup
            Log::info("Step 8: GitHub Webhook Cleanup");
            try {
                if (!empty($this->appData['github_full_name']) && !empty($this->appData['webhook_secret'])) {
                    $githubService = app(GitHubService::class);
                    $token = Setting::get('github_access_token');
                    if ($token) {
                        $hooks = $githubService->getHooks($token, $this->appData['github_full_name']);
                        if (is_array($hooks)) {
                            $webhookUrl = config('app.url') . '/api/github/webhook';
                            foreach ($hooks as $hook) {
                                if (isset($hook['config']['url']) && $hook['config']['url'] === $webhookUrl) {
                                    $githubService->deleteWebhook($token, $this->appData['github_full_name'], $hook['id']);
                                }
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Cleanup GitHub webhook failed for app {$app->id}: " . $e->getMessage());
            }

            Log::info("Cleanup complete for app: {$app->name}");
        } catch (\Throwable $e) {
            Log::error("Cleanup failed for app: " . ($this->appData['name'] ?? 'unknown'), [
                'error' => $e->getMessage()
            ]);
        }
    }
}
