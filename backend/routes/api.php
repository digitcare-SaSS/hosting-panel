<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AppController;
use App\Http\Controllers\Api\EnvController;
use App\Http\Controllers\Api\DatabaseController;
use App\Http\Controllers\Api\ServerController;
use App\Http\Controllers\Api\GitHubAuthController;
use App\Http\Controllers\Api\GitHubWebhookController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\CronJobController;
use App\Http\Controllers\Api\DomainController;
use App\Http\Controllers\Api\DnsRecordController;
use App\Http\Controllers\Api\EmailController;
use App\Http\Controllers\Api\FileManagerController;
use App\Http\Controllers\Api\QueueController;
use App\Http\Controllers\Api\TerminalController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\AppServiceController;
use App\Http\Controllers\Api\LoadBalancerSslController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\SubscriptionCheckController;
use App\Http\Controllers\Api\BillableRouteController;
use App\Http\Controllers\Api\MigrationController;
use App\Http\Controllers\Api\MigrationSourceController;
use App\Http\Middleware\VerifyMigrationSignature;

use App\Http\Controllers\Api\PaymentController;
use Illuminate\Support\Facades\Route;

// ── Auth (public) ─────────────────────────────────────────────────────────────
Route::post('/auth/login', [AuthController::class, 'login']);

// ── Public: Nginx subscription gate (called internally via auth_request) ──────
Route::get('/subscription-check', [SubscriptionCheckController::class, 'check']);
Route::get('/subscription-expired', [SubscriptionCheckController::class, 'expirationInfo']);
Route::get('/public/subscription/status', [SubscriptionCheckController::class, 'expirationInfo']);




// ── Protected routes ─────────────────────────────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {

    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::post('/auth/user', [AuthController::class, 'user']);
    Route::post('/auth/update-profile', [AuthController::class, 'updateProfile']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

    // Apps
    Route::get('/apps', [AppController::class, 'index']);
    Route::post('/apps', [AppController::class, 'store']);
    Route::get('/apps/{app}', [AppController::class, 'show']);
    Route::delete('/apps/{app}', [AppController::class, 'destroy']);
    Route::post('/apps/{app}/deploy', [AppController::class, 'deploy']);
    Route::post('/apps/{app}/php-version', [AppController::class, 'updatePhpVersion']);
    Route::post('/apps/{app}/force-stop-deployment', [AppController::class, 'forceStopDeployment']);
    Route::post('/apps/{app}/start', [AppController::class, 'start']);
    Route::post('/apps/{app}/stop', [AppController::class, 'stop']);
    Route::post('/apps/{app}/restart', [AppController::class, 'restart']);
    Route::get('/apps/{app}/crm-logs', [AppController::class, 'crmLogs']);
    Route::get('/apps/{app}/subscriptions', [AppController::class, 'subscriptions']);
    Route::post('/apps/{app}/subscriptions/activate', [AppController::class, 'activateSubscription']);

    Route::get('/apps/{app}/logs', [AppController::class, 'logs']);
    Route::get('/apps/{app}/deployments', [AppController::class, 'deployments']);
    Route::post('/apps/{app}/toggle-auto-deploy', [AppController::class, 'toggleAutoDeploy']);
    Route::post('/apps/{app}/toggle-suspend', [AppController::class, 'toggleSuspend']);
    Route::post('/apps/{app}/hide-guidelines', [AppController::class, 'hideGuidelines']);
    Route::post('/apps/{app}/ssl/setup', [AppController::class, 'setupSsl']);
    Route::post('/apps/{app}/ssl/remove', [AppController::class, 'removeSsl']);
    Route::get('/apps/{app}/ssl/details', [AppController::class, 'getSslDetails']);
    Route::post('/apps/{app}/ssl/secure-panel', [AppController::class, 'setupPanelSsl']);
    Route::post('/apps/{app}/ssl/force-https', [AppController::class, 'toggleForceHttps']);
    Route::post('/panel/ssl/force-https', [AppController::class, 'togglePanelForceHttps']);

    // Background Services
    Route::get('/apps/{app}/services/recommended', [AppServiceController::class, 'recommended']);
    Route::get('/apps/{app}/services', [AppServiceController::class, 'index']);
    Route::post('/apps/{app}/services', [AppServiceController::class, 'store']);
    Route::post('/apps/{app}/services/install-recommended', [AppServiceController::class, 'installRecommended']);
    Route::post('/apps/{app}/services/{service}/start', [AppServiceController::class, 'start']);
    Route::post('/apps/{app}/services/{service}/stop', [AppServiceController::class, 'stop']);
    Route::post('/apps/{app}/services/{service}/restart', [AppServiceController::class, 'restart']);
    Route::get('/apps/{app}/services/{service}/logs', [AppServiceController::class, 'logs']);
    Route::delete('/apps/{app}/services/{service}', [AppServiceController::class, 'destroy']);

    // Environment variables
    Route::get('/apps/{app}/env', [EnvController::class, 'index']);
    Route::put('/apps/{app}/env', [EnvController::class, 'update']);

    // Databases
    Route::get('/databases', [DatabaseController::class, 'index']);
    Route::get('/databases/{database}/credentials', [DatabaseController::class, 'credentials']);
    Route::post('/databases', [DatabaseController::class, 'store']);
    Route::post('/databases/{database}/password', [DatabaseController::class, 'updatePassword']);
    Route::delete('/databases/{database}', [DatabaseController::class, 'destroy']);

    // Database Users
    Route::get('/databases/users', [\App\Http\Controllers\Api\DatabaseUserController::class, 'index']);
    Route::post('/databases/users', [\App\Http\Controllers\Api\DatabaseUserController::class, 'store']);
    Route::post('/databases/users/{user}/password', [\App\Http\Controllers\Api\DatabaseUserController::class, 'updatePassword']);
    Route::delete('/databases/users/{user}', [\App\Http\Controllers\Api\DatabaseUserController::class, 'destroy']);
    Route::post('/databases/users/{user}/permissions', [\App\Http\Controllers\Api\DatabaseUserController::class, 'syncPermissions']);
    Route::post('/databases/users/{user}/global-privileges', [\App\Http\Controllers\Api\DatabaseUserController::class, 'syncGlobalPrivileges']);

    // Server stats
    Route::get('/server/stats', [ServerController::class, 'stats']);
    Route::get('/server/service-detail', [ServerController::class, 'serviceDetail']);
    Route::get('/server/php-config', [ServerController::class, 'getPhpConfig']);
    Route::post('/server/php-config', [ServerController::class, 'updatePhpConfig']);
    Route::get('/server/php-modules', [ServerController::class, 'getPhpModules']);
    Route::post('/server/php-modules/toggle', [ServerController::class, 'togglePhpModule']);
    Route::get('/server/php-versions', [ServerController::class, 'getPhpVersions']);
    Route::post('/server/php-install', [ServerController::class, 'installPhpVersion']);
    Route::post('/server/php-activate', [ServerController::class, 'activatePhpVersion']);
    Route::post('/server/php-uninstall', [ServerController::class, 'uninstallPhpVersion']);
    Route::get('/server/php-operation-log', [ServerController::class, 'getPhpOperationLog']);
    Route::post('/server/restart', [ServerController::class, 'restart']);

    // GitHub OAuth
    Route::get('/github/redirect', [GitHubAuthController::class, 'redirect']);
    Route::get('/github/callback', [GitHubAuthController::class, 'callback']);
    Route::get('/github/repositories', [GitHubAuthController::class, 'repositories']);
    Route::post('/github/disconnect', [GitHubAuthController::class, 'disconnect']);

    // Panel-to-panel migration
    Route::get('/migration', [MigrationController::class, 'index']);
    Route::post('/migration/confirm-password', [MigrationController::class, 'confirmPassword'])->middleware('throttle:5,1');
    Route::put('/migration/enabled', [MigrationController::class, 'setEnabled']);
    Route::post('/migration/key', [MigrationController::class, 'generateKey']);
    Route::delete('/migration/key', [MigrationController::class, 'revokeKey']);
    Route::post('/migration/connect', [MigrationController::class, 'connect']);
    Route::post('/migration/start', [MigrationController::class, 'start']);

    // Settings
    Route::get('/settings', [SettingsController::class, 'index']);
    Route::post('/settings', [SettingsController::class, 'update']);
    Route::post('/settings/logo', [SettingsController::class, 'uploadLogo']);
    Route::post('/settings/panel-logo', [SettingsController::class, 'uploadPanelLogo']);
    Route::post('/settings/setup-payment-domain', [SettingsController::class, 'setupPaymentDomain']);
    Route::post('/settings/setup-api-domain', [SettingsController::class, 'setupApiDomain']);

    // CRM Customers
    Route::apiResource('customers', CustomerController::class);
    Route::post('/customers/{customer}/deploy', [CustomerController::class, 'deploy']);
    Route::post('/customers/{customer}/force-stop-deployment', [CustomerController::class, 'forceStopDeployment']);
    Route::put('/customers/{customer}/domain', [CustomerController::class, 'updateDomain']);
    Route::get('/customers/{customer}/subscriptions', [CustomerController::class, 'subscriptions']);
    Route::post('/customers/{customer}/subscriptions/activate', [CustomerController::class, 'activateSubscription']);
    Route::get('/customers/{customer}/deployments', [CustomerController::class, 'deployments']);
    Route::get('/customers/{customer}/crm-logs', [CustomerController::class, 'crmLogs']);
    Route::post('/customers/{customer}/toggle-suspend', [CustomerController::class, 'toggleSuspend']);


    // Load Balancers
    Route::apiResource('load-balancers', \App\Http\Controllers\Api\LoadBalancerController::class);
    Route::post('/load-balancers/{loadBalancer}/domains', [\App\Http\Controllers\Api\LoadBalancerController::class, 'addDomain']);
    Route::delete('/load-balancers/{loadBalancer}/domains', [\App\Http\Controllers\Api\LoadBalancerController::class, 'removeDomain']);
    Route::post('/load-balancers/{loadBalancer}/apps', [\App\Http\Controllers\Api\LoadBalancerController::class, 'attachApp']);
    Route::delete('/load-balancers/{loadBalancer}/apps/{app}', [\App\Http\Controllers\Api\LoadBalancerController::class, 'detachApp']);

    // Load Balancer SSL
    Route::post('/load-balancers/domains/{domain}/ssl/setup', [LoadBalancerSslController::class, 'setup']);
    Route::post('/load-balancers/domains/{domain}/ssl/remove', [LoadBalancerSslController::class, 'remove']);
    Route::get('/load-balancers/domains/{domain}/ssl/details', [LoadBalancerSslController::class, 'details']);
    Route::post('/load-balancers/domains/{domain}/ssl/force-https', [LoadBalancerSslController::class, 'toggleForceHttps']);

    // Load Balancer Domain Logs
    Route::get('/load-balancers/domains/{domain}', [\App\Http\Controllers\Api\LoadBalancerController::class, 'showDomain']);
    Route::get('/load-balancers/domains/{domain}/logs', [\App\Http\Controllers\Api\LoadBalancerController::class, 'domainLogs']);
    Route::get('/load-balancers/domains/{domain}/subscriptions', [\App\Http\Controllers\Api\LoadBalancerController::class, 'subscriptions']);
    Route::post('/load-balancers/domains/{domain}/subscriptions/activate', [\App\Http\Controllers\Api\LoadBalancerController::class, 'activateSubscription']);
    Route::post('/load-balancers/domains/{domain}/toggle-suspend', [\App\Http\Controllers\Api\LoadBalancerController::class, 'toggleSuspend']);

    // Cron Jobs
    Route::get('/cron-jobs', [CronJobController::class, 'index']);
    Route::post('/cron-jobs', [CronJobController::class, 'store']);
    Route::put('/cron-jobs/{cronJob}', [CronJobController::class, 'update']);
    Route::delete('/cron-jobs/{cronJob}', [CronJobController::class, 'destroy']);
    Route::post('/cron-jobs/{cronJob}/toggle', [CronJobController::class, 'toggle']);
    Route::get('/cron-jobs/system-logs', [CronJobController::class, 'systemLogs']);
    Route::get('/cron-jobs/{cronJob}/logs', [CronJobController::class, 'logs']);

    // DNS Domains
    Route::get('/domains/find-parent', [DomainController::class, 'findParent']);
    Route::get('/domains', [DomainController::class, 'index']);
    Route::post('/domains', [DomainController::class, 'store']);
    Route::get('/domains/{domain}', [DomainController::class, 'show']);
    Route::put('/domains/{domain}', [DomainController::class, 'update']);
    Route::delete('/domains/{domain}', [DomainController::class, 'destroy']);
    Route::post('/domains/{domain}/sync', [DomainController::class, 'sync']);

    // DNS Records (nested under domain)
    Route::get('/domains/{domain}/records', [DnsRecordController::class, 'index']);
    Route::post('/domains/{domain}/records', [DnsRecordController::class, 'store']);
    Route::put('/domains/{domain}/records/{record}', [DnsRecordController::class, 'update']);
    Route::delete('/domains/{domain}/records/{record}', [DnsRecordController::class, 'destroy']);

    // App-level DNS management (shortcut via app)
    Route::get('/apps/{app}/domain', function (\App\Models\App $app) {
        return response()->json($app->domainRecord?->load('dnsRecords'));
    });
    Route::post('/apps/{app}/domain/records', function (\App\Models\App $app, \Illuminate\Http\Request $request) {
        $domain = $app->domainRecord;
        if (!$domain) return response()->json(['message' => 'No domain linked to this app'], 404);
        $validated = $request->validate([
            'type' => 'required|in:A,AAAA,CNAME,MX,TXT,NS,SRV,CAA',
            'name' => 'required|string|max:255',
            'value' => 'required|string',
            'ttl' => 'nullable|integer|min:60',
            'priority' => 'nullable|integer',
        ]);
        $record = $domain->dnsRecords()->create($validated);
        app(\App\Services\DnsService::class)->syncRecords($domain->fresh());
        return response()->json($record, 201);
    });
    Route::delete('/apps/{app}/domain/records/{record}', function (\App\Models\App $app, \App\Models\DnsRecord $record) {
        $domain = $app->domainRecord;
        if (!$domain || $record->domain_id !== $domain->id) abort(404);
        $record->delete();
        app(\App\Services\DnsService::class)->syncRecords($domain->fresh());
        return response()->json(['message' => 'Deleted']);
    });
    Route::post('/apps/{app}/domain/sync', function (\App\Models\App $app) {
        $domain = $app->domainRecord;
        if (!$domain) return response()->json(['message' => 'No domain'], 404);
        app(\App\Services\DnsService::class)->syncRecords($domain->fresh());
        return response()->json(['message' => 'DNS zone synced']);
    });

    // Backfill default DNS records for existing domains
    Route::post('/apps/{app}/domain/setup-defaults', function (\App\Models\App $app) {
        $domain = $app->domainRecord;
        if (!$domain) return response()->json(['message' => 'No domain linked'], 404);
        $dnsService = app(\App\Services\DnsService::class);
        $dnsService->createDefaultRecords($domain);
        $dnsService->generateZone($domain->fresh()->load('dnsRecords'));
        return response()->json($domain->fresh()->load('dnsRecords'));
    });

    // Email Management
    Route::get('/email/domains', [EmailController::class, 'indexDomains']);
    Route::post('/email/domains', [EmailController::class, 'storeDomain']);
    Route::delete('/email/domains/{emailDomain}', [EmailController::class, 'destroyDomain']);

    Route::get('/email/domains/{emailDomain}/accounts', [EmailController::class, 'indexAccounts']);
    Route::post('/email/domains/{emailDomain}/accounts', [EmailController::class, 'storeAccount']);
    Route::put('/email/domains/{emailDomain}/accounts/{account}', [EmailController::class, 'updateAccount']);
    Route::delete('/email/domains/{emailDomain}/accounts/{account}', [EmailController::class, 'destroyAccount']);

    Route::get('/email/domains/{emailDomain}/aliases', [EmailController::class, 'indexAliases']);
    Route::post('/email/domains/{emailDomain}/aliases', [EmailController::class, 'storeAlias']);
    Route::delete('/email/domains/{emailDomain}/aliases/{alias}', [EmailController::class, 'destroyAlias']);

    // File Manager
    Route::get('/files', [FileManagerController::class, 'index']);
    Route::get('/files/content', [FileManagerController::class, 'show']);
    Route::get('/files/download', [FileManagerController::class, 'download']);
    Route::get('/files/search', [FileManagerController::class, 'search']);
    Route::post('/files', [FileManagerController::class, 'store']);
    Route::put('/files', [FileManagerController::class, 'update']);
    Route::delete('/files', [FileManagerController::class, 'destroy']);
    Route::post('/files/bulk-delete', [FileManagerController::class, 'bulkDelete']);
    Route::post('/files/rename', [FileManagerController::class, 'rename']);
    Route::post('/files/copy', [FileManagerController::class, 'copy']);
    Route::post('/files/upload', [FileManagerController::class, 'upload']);
    Route::post('/files/chmod', [FileManagerController::class, 'chmod']);
    Route::post('/files/compress', [FileManagerController::class, 'compress']);
    Route::post('/files/extract', [FileManagerController::class, 'extract']);

    // Terminal Access
    Route::get('/terminal/info', [TerminalController::class, 'info']);
    Route::get('/terminal/autocomplete', [TerminalController::class, 'autocomplete']);
    Route::post('/terminal/execute', [TerminalController::class, 'execute']);

    // Queue Monitoring
    Route::get('/queue', [QueueController::class, 'index']);
    Route::post('/queue/retry/{id}', [QueueController::class, 'retry']);
    Route::delete('/queue/cancel/{id}', [QueueController::class, 'cancel']);
    Route::post('/queue/clear', [QueueController::class, 'clear']);

    // ── Subscription Plans & Status ────────────────────────────────────────────
    Route::get('/subscription/plans',   [SubscriptionController::class, 'plans']);
    Route::get('/subscription/current', [SubscriptionController::class, 'current']);
    Route::post('/subscription/subscribe', [SubscriptionController::class, 'subscribe']);
    Route::post('/subscription/cancel',    [SubscriptionController::class, 'cancel']);

    // Admin Plan Management
    Route::get('subscription/stats', [SubscriptionController::class, 'adminStats']);
    Route::get('subscription/transactions', [SubscriptionController::class, 'transactions']);
    Route::get('subscription/bkash-token', [SubscriptionController::class, 'getBkashToken']);
    Route::post('subscription/transactions/{transaction}/refund', [SubscriptionController::class, 'refundTransaction']);
    Route::get('subscription/admin-plans', [SubscriptionController::class, 'indexPlansAdmin']);
    Route::post('subscription/admin-plans', [SubscriptionController::class, 'storePlan']);
    Route::put('subscription/admin-plans/{plan}', [SubscriptionController::class, 'updatePlan']);
    Route::delete('subscription/admin-plans/{plan}', [SubscriptionController::class, 'destroyPlan']);
    Route::get('subscription/domain-plans/{domain}', [SubscriptionController::class, 'getDomainVisiblePlans']);
    Route::post('subscription/domain-plans/{domain}', [SubscriptionController::class, 'updateDomainVisiblePlans']);
    Route::post('subscription/regenerate-validation', [SubscriptionController::class, 'regenerateValidation']);

    // ── Billable Routes (admin-managed metered paths) ──────────────────────────
    Route::get('/subscription/billable-routes',          [BillableRouteController::class, 'index']);
    Route::post('/subscription/billable-routes',         [BillableRouteController::class, 'store']);
    Route::put('/subscription/billable-routes/{billableRoute}',    [BillableRouteController::class, 'update']);
    Route::delete('/subscription/billable-routes/{billableRoute}', [BillableRouteController::class, 'destroy']);
    Route::get('/subscription/usage-logs',               [BillableRouteController::class, 'usageLogs']);
});



// Panel-to-panel migration: called by the NEW panel, authenticated by the signed migration key (not a login)
Route::prefix('migration/source')
    ->middleware([VerifyMigrationSignature::class, 'throttle:120,1'])
    ->group(function () {
        Route::post('/handshake', [MigrationSourceController::class, 'handshake']);
        Route::post('/export', [MigrationSourceController::class, 'startExport']);
        Route::get('/export', [MigrationSourceController::class, 'exportStatus']);
        Route::get('/export/download', [MigrationSourceController::class, 'download']);
        Route::post('/complete', [MigrationSourceController::class, 'complete']);
    });
// Progress survives the restore replacing the admin's session: authorised by the migration's own token
Route::get('/public/migration/progress', [MigrationController::class, 'progress'])->middleware('throttle:120,1');

// GitHub Webhook (Public)
Route::post('/github/webhook', [GitHubWebhookController::class, 'handle']);

Route::get('/public/portal/info', [\App\Http\Controllers\Api\PublicPortalController::class, 'info']);
Route::get('/public/panel/branding', [\App\Http\Controllers\Api\SettingsController::class, 'branding']);
Route::post('/public/portal/subscribe', [\App\Http\Controllers\Api\PublicPortalController::class, 'subscribe']);
Route::get('/public/payment/result/{txId}', [\App\Http\Controllers\Api\PublicPortalController::class, 'paymentResult']);
Route::get('/public/docs/json', [\App\Http\Controllers\Api\ApiDocsController::class, 'index']);
