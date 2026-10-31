<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\App as AppModel;
use App\Models\Domain;
use App\Models\Deployment;
use App\Services\DeploymentService;
use App\Services\PM2Service;
use App\Services\NginxConfigService;
use App\Services\GitHubService;
use App\Services\DnsService;
use App\Services\SslService;
use App\Models\Setting;
use App\Jobs\DeployApp;
use App\Jobs\DeleteApp;
use App\Models\Subscription;
use App\Models\PaymentTransaction;
use App\Models\SubscriptionPlan;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AppController extends Controller
{
    public function __construct(
        private DeploymentService $deploymentService,
        private PM2Service $pm2Service,
        private NginxConfigService $nginxService,
        private GitHubService $github,
        private \App\Services\DatabaseService $dbService,
        private DnsService $dnsService,
        private SslService $sslService
    ) {}

    public function index()
    {
        $apps = AppModel::with('latestDeployment')->get();
        return response()->json($apps);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name'             => 'required|string|unique:apps,name',
            'type'             => 'required|in:nextjs,laravel,static',
            'domain'           => 'required|string|unique:apps,domain',
            'git_url'          => 'required|string',
            'branch'           => 'nullable|string',
            'github_full_name' => 'nullable|string',
            'github_id'        => 'nullable|integer',
            'auto_deploy'      => 'nullable|boolean',
            'env_vars'         => 'nullable|string',
            'auto_db_create'   => 'nullable|boolean',
        ]);

        $webhookSecret = null;
        if (!empty($validated['auto_deploy']) && !empty($validated['github_full_name'])) {
            $webhookSecret = Str::random(32);
        }

        $app = AppModel::create([
            'name'             => $validated['name'],
            'type'             => $validated['type'],
            'domain'           => $validated['domain'],
            'git_url'          => $validated['git_url'],
            'branch'           => $validated['branch'] ?? 'main',
            'status'           => 'idle',
            'github_full_name' => $validated['github_full_name'] ?? null,
            'github_id'        => $validated['github_id'] ?? null,
            'webhook_secret'   => $webhookSecret,
            'auto_deploy'      => $validated['auto_deploy'] ?? false,
            'ssl_enabled'      => true,
            'force_https'      => true,
        ]);

        // Note: env_vars column stores the actual environment file name (e.g. .env or .env.production).
        // If empty, it defaults based on app type in the App model's getEnvFilePath().
        if (!empty($validated['env_vars'])) {
            $app->update(['env_vars' => $validated['env_vars']]);
        }

        // Auto Database Creation for Laravel
        if ($app->type === 'laravel' && !empty($validated['auto_db_create'])) {
            try {
                $db = $this->dbService->createForApp($app);

                // Inject credentials into environment variables
                $envs = [
                    'DB_CONNECTION' => 'pgsql',
                    'DB_HOST'       => '127.0.0.1',
                    'DB_PORT'       => '5432',
                    'DB_DATABASE'   => $db->db_name,
                    'DB_USERNAME'   => $db->db_user,
                    'DB_PASSWORD'   => $db->db_password,
                ];

                $app->updateEnvVars($envs);
            } catch (\Exception $e) {
                // We log the error but don't fail the whole app creation
                \Illuminate\Support\Facades\Log::error("Auto DB creation failed for app {$app->id}: " . $e->getMessage());
            }
        }

        // If auto-deploy is enabled, create GitHub webhook
        if ($app->webhook_secret && $app->github_full_name) {
            $token = Setting::get('github_access_token');
            if ($token) {
                $this->github->createWebhook($token, $app->github_full_name, $app->webhook_secret);
            }
        }

        // Auto-create Domain record with default nameservers and records
        $this->dnsService->createManagedDomain($app->domain, $app->id);

        // [REQUIRED] Write initial Nginx config immediately so placeholders (auth_request, etc.)
        // are replaced at creation time. This prevents literal placeholders in /etc/nginx.
        // try {
        //     $this->nginxService->generate($app);
        // } catch (\Exception $e) {
        //     \Illuminate\Support\Facades\Log::warning("Initial Nginx gen failed for {$app->domain}: " . $e->getMessage());
        // }


        // If this is the first app, set it as the primary panel domain and update site address
        if (\App\Models\App::count() === 1) {
            $port = env('PANEL_PORT', '8083');
            Setting::set('panel_url', "http://{$app->domain}:{$port}");
        }

        return response()->json($app, 201);
    }

    public function toggleAutoDeploy(AppModel $app)
    {
        // Fallback: try to extract github_full_name from git_url if missing
        if (!$app->github_full_name && str_contains($app->git_url, 'github.com')) {
            if (preg_match('/github\.com\/([^\/]+\/[^\/\.]+)/', $app->git_url, $matches)) {
                $app->update(['github_full_name' => $matches[1]]);
            }
        }

        if (!$app->github_full_name) {
            return response()->json(['error' => 'Automatic deployment requires a GitHub repository.'], 422);
        }

        if (!$app->auto_deploy) {
            // Enabling
            $app->webhook_secret = Str::random(32);
            $token = Setting::get('github_access_token');
            if ($token) {
                $this->github->createWebhook($token, $app->github_full_name, $app->webhook_secret);
            }
        } else {
            // Disabling
            $app->webhook_secret = null;
        }

        $app->auto_deploy = !$app->auto_deploy;
        $app->save();

        return response()->json($app);
    }

    public function show(AppModel $app)
    {
        $app->load(['latestDeployment', 'databases', 'domainRecord.dnsRecords']);

        // Add relevant global settings for the app dashboard
        $settings = [
            'server_ip' => \App\Models\Setting::get('server_ip'),
            'ns_default_domain' => \App\Models\Setting::get('ns_default_domain'),
            'dns_default_ns1' => \App\Models\Setting::get('dns_default_ns1'),
            'dns_default_ns2' => \App\Models\Setting::get('dns_default_ns2'),
            'dns_default_ns3' => \App\Models\Setting::get('dns_default_ns3'),
            'dns_default_ns4' => \App\Models\Setting::get('dns_default_ns4'),
            'github_connected' => (bool) \App\Models\Setting::get('github_access_token'),
        ];

        return response()->json(array_merge($app->toArray(), ['settings' => $settings]));
    }

    public function destroy(AppModel $app)
    {
        // Snapshot data for background job including relations
        $appData = $app->toArray();
        $appData['id'] = $app->id;
        $appData['databases'] = $app->databases->toArray();
        $appData['services'] = $app->services->toArray();

        // [CRITICAL] Find domain ID before app is deleted, because app_id is nulled on delete
        $domain = \App\Models\Domain::where('app_id', $app->id)->first();
        $appData['domain_id'] = $domain?->id;

        DeleteApp::dispatch($appData);

        $app->delete();
        return response()->json(['message' => 'App scheduled for deletion and cleanup']);
    }

    public function deploy(AppModel $app)
    {
        $app->update(['status' => 'deploying']);
        $deployment = Deployment::create([
            'app_id' => $app->id,
            'status'     => 'deploying',
            'log_output' => 'Starting manual deployment...'
        ]);

        DeployApp::dispatch($app, $deployment);

        return response()->json([
            'message'    => 'Deployment triggered',
            'deployment' => $deployment
        ]);
    }

    public function deployZeroDowntime(AppModel $app)
    {
        if ($app->type !== 'nextjs') {
            return response()->json(['error' => 'Zero-downtime deployment is only available for Next.js apps.'], 422);
        }

        $app->update(['status' => 'deploying']);
        $deployment = Deployment::create([
            'app_id' => $app->id,
            'status'     => 'deploying',
            'log_output' => 'Starting zero-downtime deployment...'
        ]);

        DeployApp::dispatch($app, $deployment, true);

        return response()->json([
            'message'    => 'Zero-downtime deployment triggered',
            'deployment' => $deployment
        ]);
    }

    public function forceStopDeployment(AppModel $app)
    {
        $deployment = $app->deployments()->where('status', 'deploying')->latest()->first();
        if ($deployment) {
            $deployment->update([
                'status' => 'failed',
                'log' => $deployment->log . "\n\n[FORCE STOP] Deployment terminated by user manually."
            ]);
        }

        $app->update(['status' => 'idle']);

        return response()->json(['message' => 'Deployment force stopped']);
    }

    public function start(AppModel $app)
    {
        if ($app->type !== 'nextjs') {
            return response()->json(['message' => 'Start only applies to Next.js apps. Laravel/static are served by Nginx/PHP-FPM.']);
        }

        $result = $this->pm2Service->start($app);
        $app->update(['status' => $result['exit_code'] === 0 ? 'running' : 'error']);
        return response()->json(['exit_code' => $result['exit_code'], 'output' => $result['output']]);
    }

    public function stop(AppModel $app)
    {
        if ($app->type !== 'nextjs') {
            return response()->json(['message' => 'Stop only applies to Next.js apps.']);
        }

        $result = $this->pm2Service->stop($app);
        $app->update(['status' => $result['exit_code'] === 0 ? 'stopped' : 'error']);
        return response()->json(['exit_code' => $result['exit_code'], 'output' => $result['output']]);
    }

    public function restart(AppModel $app)
    {
        if ($app->type !== 'nextjs') {
            return response()->json(['message' => 'Restart only applies to Next.js apps.']);
        }

        $result = $this->pm2Service->restart($app);
        $app->update(['status' => $result['exit_code'] === 0 ? 'running' : 'error']);
        return response()->json(['exit_code' => $result['exit_code'], 'output' => $result['output']]);
    }

    public function logs(AppModel $app, Request $request)
    {
        $type = $request->query('type', 'app');

        if ($type === 'server-error') {
            if (!$app->domain) return response()->json(['logs' => 'No domain associated with this app.']);
            $logFile = "/var/log/nginx/{$app->domain}-error.log";
            $output = file_exists($logFile) ? shell_exec("tail -n 200 " . escapeshellarg($logFile) . " 2>&1") : 'No server error logs found.';
            return response()->json(['logs' => $output ?: 'Log file is empty or unreadable.']);
        }

        if ($type === 'server-access') {
            if (!$app->domain) return response()->json(['logs' => 'No domain associated with this app.']);
            $logFile = "/var/log/nginx/{$app->domain}-access.log";
            $output = file_exists($logFile) ? shell_exec("tail -n 200 " . escapeshellarg($logFile) . " 2>&1") : 'No server access logs found.';
            return response()->json(['logs' => $output ?: 'Log file is empty or unreadable.']);
        }

        if ($app->type === 'nextjs') {
            $logs = $this->pm2Service->logs($app, 200);
        } elseif ($app->type === 'laravel' && $app->deploy_path) {
            $logFile = "{$app->deploy_path}/storage/logs/laravel.log";
            $logs = file_exists($logFile) ? shell_exec("tail -n 200 " . escapeshellarg($logFile)) : 'No logs found.';
        } else {
            $logs = 'No runtime logs available for this app type.';
        }

        return response()->json(['logs' => $logs]);
    }

    public function deployments(AppModel $app)
    {
        return response()->json($app->deployments()->orderByDesc('created_at')->get());
    }

    public function hideGuidelines(AppModel $app)
    {
        $app->update(['hide_guidelines' => true]);
        return response()->json(['success' => true]);
    }

    public function setupSsl(AppModel $app)
    {
        $result = $this->sslService->setupSsl($app);
        return response()->json(array_merge($result, [
            'app' => $app->fresh()
        ]), $result['success'] ? 200 : 500);
    }

    public function removeSsl(AppModel $app)
    {
        $result = $this->sslService->removeSsl($app);
        return response()->json(array_merge($result, [
            'app' => $app->fresh()
        ]));
    }

    public function getSslDetails(AppModel $app)
    {
        $details = $this->sslService->getCertificateDetails($app);
        return response()->json($details);
    }

    public function setupPanelSsl(AppModel $app)
    {
        // Safety check: only allow if domain matches setting
        $panelDomain = Setting::get('ns_default_domain');
        if ($app->domain !== $panelDomain) {
            return response()->json(['success' => false, 'message' => "Panel domain mismatch. Expected: {$panelDomain}"], 403);
        }

        $result = $this->sslService->securePanel($app->domain);

        if ($result['success']) {
            // Automatically enable Force HTTPS if panel security was successful
            $this->sslService->togglePanelForceHttps(true);

            // Update panel url to HTTPS
            $port = env('PANEL_PORT', '8083');
            Setting::set('panel_url', "https://{$app->domain}:{$port}");
        }

        return response()->json($result, $result['success'] ? 200 : 500);
    }

    public function toggleForceHttps(AppModel $app)
    {
        if (!$app->ssl_enabled || $app->ssl_status !== 'active') {
            return response()->json([
                'success' => false,
                'message' => 'SSL must be active before toggling Force HTTPS.',
            ], 422);
        }

        $enable = !$app->force_https;
        $result = $this->sslService->toggleForceHttps($app, $enable);

        return response()->json(array_merge($result, [
            'app' => $app->fresh(),
        ]), $result['success'] ? 200 : 500);
    }

    public function togglePanelForceHttps(Request $request)
    {
        $enable = (bool) $request->input('enable', true);
        $result = $this->sslService->togglePanelForceHttps($enable);
        return response()->json($result, $result['success'] ? 200 : 500);
    }

    public function crmLogs(AppModel $app)
    {
        $customer = \App\Models\Customer::where('resource_type', 'app')
            ->where('resource_id', $app->id)
            ->first();

        if (!$customer) {
            return response()->json([]);
        }

        $logs = $customer->crmApiLogs()->orderByDesc('created_at')->get();
        return response()->json($logs);
    }

    public function subscriptions(AppModel $app)
    {
        $domain = $app->domain;

        if (!$domain) {
            return response()->json(['domain' => null, 'subscriptions' => [], 'transactions' => []]);
        }

        $subscriptions = Subscription::with('plan')
            ->where('domain', $domain)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn($sub) => [
                'id'             => $sub->id,
                'plan'           => $sub->plan,
                'status'         => $sub->status,
                'starts_at'      => $sub->starts_at,
                'ends_at'        => $sub->ends_at,
                'credit_balance' => $sub->credit_balance,
                'is_active'      => $sub->isActive(),
                'is_credit_type' => $sub->isCreditType(),
                'created_at'     => $sub->created_at,
            ]);

        $transactions = PaymentTransaction::with('plan')
            ->where('domain', $domain)
            ->orderByDesc('created_at')
            ->limit(20)
            ->get()
            ->map(fn($tx) => [
                'id'             => $tx->id,
                'plan'           => $tx->plan,
                'amount'         => $tx->amount,
                'status'         => $tx->status,
                'gateway'        => $tx->gateway,
                'gateway_ref'    => $tx->gateway_ref,
                'created_at'     => $tx->created_at,
            ]);

        return response()->json(['domain' => $domain, 'subscriptions' => $subscriptions, 'transactions' => $transactions]);
    }

    public function activateSubscription(Request $request, AppModel $app)
    {
        $validated = $request->validate([
            'plan_id'        => 'required|exists:subscription_plans,id',
            'custom_ends_at' => 'nullable|date',
        ]);

        $domain = $app->domain;

        if (!$domain) {
            return response()->json(['error' => 'App has no domain configured.'], 400);
        }

        $plan = SubscriptionPlan::findOrFail($validated['plan_id']);
        $subscriptionService = app(\App\Services\SubscriptionService::class);

        $subscription = $subscriptionService->activateManual($domain, $plan, $validated['custom_ends_at'] ?? null);

        // Record a manual payment transaction to keep history clean
        PaymentTransaction::create([
            'user_id'         => $request->user()?->id,
            'subscription_id' => $subscription->id,
            'plan_id'         => $plan->id,
            'domain'          => $domain,
            'gateway'         => 'manual',
            'amount'          => 0, // Admin granted
            'currency'        => 'USD',
            'status'          => 'completed',
            'transaction_id'  => 'MANUAL_' . Str::random(10),
        ]);

        return response()->json(['message' => 'Subscription activated successfully.', 'subscription' => $subscription]);
    }

    public function toggleSuspend(AppModel $app)
    {
        if ($app->status === 'deactivated') {
            $newStatus = ($app->type === 'nextjs') ? 'stopped' : 'running';
            $app->update(['status' => $newStatus]);
            return response()->json(['message' => 'Service reactivated.', 'status' => $newStatus]);
        } else {
            $app->update(['status' => 'deactivated']);
            return response()->json(['message' => 'Service suspended.', 'status' => 'stopped']);
        }
    }

    public function updatePhpVersion(AppModel $app, Request $request)
    {
        $validated = $request->validate([
            'version' => 'required|string|regex:/^\d+\.\d+$/'
        ]);

        $version = $validated['version'];

        // Verify version exists
        if (!file_exists("/usr/sbin/php-fpm{$version}")) {
            return response()->json(['error' => "PHP version {$version} is not installed on this server."], 422);
        }

        $app->update(['php_version' => $version]);

        // Regenerate Nginx config
        try {
            $this->nginxService->generate($app);
            if ($app->ssl_enabled) {
                $this->nginxService->generateSsl($app);
            }
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to regenerate Nginx config: ' . $e->getMessage()], 500);
        }

        return response()->json(['message' => "Successfully switched to PHP {$version} for {$app->name}."]);
    }
}
