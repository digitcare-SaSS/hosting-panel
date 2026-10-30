<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SettingsController extends Controller
{
    public function index()
    {
        return response()->json([
            'github_client_id' => Setting::get('github_client_id'),
            'github_client_secret' => Setting::get('github_client_secret'),
            'github_webhook_secret' => Setting::get('github_webhook_secret'),
            'github_connected' => (bool) Setting::get('github_access_token'),
            'dns_default_ns1' => Setting::get('dns_default_ns1'),
            'dns_default_ns2' => Setting::get('dns_default_ns2'),
            'dns_default_ns3' => Setting::get('dns_default_ns3'),
            'dns_default_ns4' => Setting::get('dns_default_ns4'),
            'crm_creation_type' => Setting::get('crm_creation_type', 'load_balancer'),
            'crm_default_lb_id' => Setting::get('crm_default_lb_id'),
            'crm_default_deployment_domain' => Setting::get('crm_default_deployment_domain'),
            'panel_url' => Setting::get('panel_url'),
            'panel_name' => Setting::get('panel_name'),
            'panel_logo' => Setting::get('panel_logo') ? \Illuminate\Support\Facades\Storage::disk('public')->url(Setting::get('panel_logo')) : null,
            'server_ip' => Setting::get('server_ip'),
            'ns_default_domain' => Setting::get('ns_default_domain'),
            'panel_domain_alert_dismissed' => (bool) Setting::get('panel_domain_alert_dismissed', false),
            'panel_force_https' => (bool) Setting::get('panel_force_https', false),
            'crm_api_enabled' => (bool) Setting::get('crm_api_enabled', false),
            'crm_api_url' => Setting::get('crm_api_url'),
            'crm_api_method' => Setting::get('crm_api_method', 'POST'),
            'crm_api_payload_template' => Setting::get('crm_api_payload_template', "{\n  \"id\": \"{id}\",\n  \"name\": \"{name}\",\n  \"email\": \"{email}\",\n  \"domain\": \"{domain}\",\n  \"status\": \"{status}\"\n}"),
            'crm_api_auth_enabled' => (bool) Setting::get('crm_api_auth_enabled', false),
            'crm_api_auth_url' => Setting::get('crm_api_auth_url'),
            'crm_api_auth_payload' => Setting::get('crm_api_auth_payload', "{\n  \"username\": \"admin\",\n  \"password\": \"password\"\n}"),
            'crm_api_auth_token_key' => Setting::get('crm_api_auth_token_key', 'access_token'),
            'crm_api_auth_token_type' => Setting::get('crm_api_auth_token_type', 'Bearer'),

            // ── Subscription & Payment Settings ──────────────────────────────
            'subscription_enabled'           => filter_var(Setting::get('subscription_enabled', false), FILTER_VALIDATE_BOOLEAN),
            // Read-only here: toggled via PUT /migration/enabled (needs password confirmation)
            'migration_enabled'              => \App\Services\Migration\MigrationSwitch::isOn(),
            'payment_callback_base_url'      => Setting::get('payment_callback_base_url'),

            // bKash
            'bkash_enabled'                  => (bool) Setting::get('bkash_enabled', false),
            'bkash_base_url'                 => Setting::get('bkash_base_url', 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'),
            'bkash_app_key'                  => Setting::get('bkash_app_key'),
            'bkash_app_secret'               => Setting::get('bkash_app_secret'),
            'bkash_username'                 => Setting::get('bkash_username'),
            'bkash_password'                 => Setting::get('bkash_password'),
            'bkash_sandbox'                  => (bool) Setting::get('bkash_sandbox', true),

            // Nagad
            'nagad_enabled'                  => (bool) Setting::get('nagad_enabled', false),
            'nagad_base_url'                 => Setting::get('nagad_base_url', 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0'),
            'nagad_merchant_id'              => Setting::get('nagad_merchant_id'),
            'nagad_merchant_private_key'     => Setting::get('nagad_merchant_private_key'),
            'nagad_pg_public_key'            => Setting::get('nagad_pg_public_key'),
            'nagad_sandbox'                  => (bool) Setting::get('nagad_sandbox', true),

            // SSL Commerce
            'sslcommerz_enabled'             => (bool) Setting::get('sslcommerz_enabled', false),
            'sslcommerz_base_url'            => Setting::get('sslcommerz_base_url', 'https://sandbox.sslcommerz.com'),
            'sslcommerz_store_id'            => Setting::get('sslcommerz_store_id'),
            'sslcommerz_store_password'      => Setting::get('sslcommerz_store_password'),
            'sslcommerz_sandbox'             => (bool) Setting::get('sslcommerz_sandbox', true),

            // Branding
            'gateway_logo_url'               => Setting::get('gateway_logo_url'),
            'support_email'                  => Setting::get('support_email', 'support@sadamiahosing.com'),
            'support_whatsapp'               => Setting::get('support_whatsapp'),
            'support_facebook'               => Setting::get('support_facebook'),
            'support_mobile'                 => Setting::get('support_mobile'),
            'portal_welcome_html'            => Setting::get('portal_welcome_html'),
        ]);
    }

    public function branding()
    {
        $logo = Setting::get('panel_logo');
        if ($logo && !str_starts_with($logo, 'http')) {
            $logo = \Illuminate\Support\Facades\Storage::disk('public')->url($logo);
        }

        return response()->json([
            'panel_name' => Setting::get('panel_name', 'Sada Mia Panel'),
            'panel_logo' => $logo,
        ]);
    }

    public function uploadPanelLogo(Request $request)
    {
        $request->validate([
            'logo' => 'required|image|max:2048',
        ]);

        $file = $request->file('logo');
        $filename = 'panel_logo_' . time() . '.' . $file->getClientOriginalExtension();

        $path = $file->storeAs('logos', $filename, 'public');

        if (!$path) {
            return response()->json(['message' => 'Failed to save panel logo to storage. Check folder permissions.'], 500);
        }

        // Store only the relative path (relative to the 'public' disk root)
        Setting::set('panel_logo', 'logos/' . $filename);

        $url = \Illuminate\Support\Facades\Storage::disk('public')->url('logos/' . $filename);

        return response()->json(['url' => $url, 'message' => 'Panel Logo uploaded successfully.']);
    }

    public function uploadLogo(Request $request)
    {
        $request->validate([
            'logo' => 'required|image|max:2048',
        ]);

        $file = $request->file('logo');
        $filename = 'gateway_logo_' . time() . '.' . $file->getClientOriginalExtension();

        // Save to storage/app/public/logos (gitignored)
        $path = $file->storeAs('logos', $filename, 'public');

        if (!$path) {
            return response()->json(['message' => 'Failed to save logo to storage. Check folder permissions.'], 500);
        }

        // Get the clean public URL via Storage disk
        $url = Storage::disk('public')->url($path);

        // If a dedicated payment base URL is set, swap the host part
        $baseUrl = Setting::get('payment_callback_base_url');
        if ($baseUrl) {
            $appUrl = config('app.url');
            $url = str_replace(rtrim($appUrl, '/'), rtrim($baseUrl, '/'), $url);
        }

        Setting::set('gateway_logo_url', $url);

        return response()->json(['url' => $url, 'message' => 'Logo uploaded successfully.']);
    }

    public function update(Request $request)
    {
        $validated = $request->validate([
            'github_client_id' => 'nullable|string',
            'github_client_secret' => 'nullable|string',
            'github_webhook_secret' => 'nullable|string',
            'dns_default_ns1' => 'nullable|string',
            'dns_default_ns2' => 'nullable|string',
            'dns_default_ns3' => 'nullable|string',
            'dns_default_ns4' => 'nullable|string',
            'crm_creation_type' => 'nullable|in:app,load_balancer',
            'crm_default_lb_id' => 'nullable|integer',
            'crm_default_deployment_domain' => 'nullable|string',
            'panel_url' => 'nullable|string',
            'panel_name' => 'nullable|string',
            'server_ip' => 'nullable|ip',
            'ns_default_domain' => 'nullable|string',
            'panel_domain_alert_dismissed' => 'nullable|boolean',
            'panel_force_https' => 'nullable|boolean',
            'crm_api_enabled' => 'nullable|boolean',
            'crm_api_url' => 'nullable|string',
            'crm_api_method' => 'nullable|string',
            'crm_api_payload_template' => 'nullable|string',
            'crm_api_auth_enabled' => 'nullable|boolean',
            'crm_api_auth_url' => 'nullable|string',
            'crm_api_auth_payload' => 'nullable|string',
            'crm_api_auth_token_key'      => 'nullable|string',
            'crm_api_auth_token_type'     => 'nullable|string',

            // Subscription & Payment
            'subscription_enabled'        => 'nullable|boolean',
            'payment_callback_base_url'   => 'nullable|string',

            // bKash
            'bkash_enabled'               => 'nullable|boolean',
            'bkash_base_url'              => 'nullable|string',
            'bkash_app_key'               => 'nullable|string',
            'bkash_app_secret'            => 'nullable|string',
            'bkash_username'              => 'nullable|string',
            'bkash_password'              => 'nullable|string',
            'bkash_sandbox'               => 'nullable|boolean',

            // Nagad
            'nagad_enabled'               => 'nullable|boolean',
            'nagad_base_url'              => 'nullable|string',
            'nagad_merchant_id'           => 'nullable|string',
            'nagad_merchant_private_key'  => 'nullable|string',
            'nagad_pg_public_key'         => 'nullable|string',
            'nagad_sandbox'               => 'nullable|boolean',

            // SSL Commerce
            'sslcommerz_enabled'          => 'nullable|boolean',
            'sslcommerz_base_url'         => 'nullable|string',
            'sslcommerz_store_id'         => 'nullable|string',
            'sslcommerz_store_password'   => 'nullable|string',
            'sslcommerz_sandbox'          => 'nullable|boolean',
            'support_email'               => 'nullable|email',
            'support_whatsapp'            => 'nullable|string',
            'support_facebook'            => 'nullable|string',
            'support_mobile'              => 'nullable|string',
        ]);

        if ($request->has('portal_welcome_html')) {
            Setting::set('portal_welcome_html', $request->input('portal_welcome_html'));
        }



        if (isset($validated['panel_url']) && !empty($validated['panel_url'])) {
            $url = $validated['panel_url'];

            // Ensure protocol
            if (!preg_match("~^(?:f|ht)tps?://~i", $url)) {
                $url = "http://" . $url;
            }

            $parsed = parse_url($url);
            $port = env('PANEL_PORT', '8083');

            // If port is not in the URL, append it
            if (!isset($parsed['port']) && $port) {
                $url = rtrim($url, '/') . ':' . $port;
            }

            $validated['panel_url'] = $url;
        }

        foreach ($validated as $key => $value) {
            Setting::set($key, $value);

            // Sync specific keys to .env
            if ($key === 'panel_url') {
                $this->updateEnv('APP_URL', $value);
            }
            if ($key === 'payment_callback_base_url') {
                $this->updateEnv('PAYMENT_CALLBACK_BASE_URL', $value);
            }
        }

        return response()->json(['message' => 'Settings updated successfully']);
    }

    private function updateEnv($key, $value)
    {
        try {
            $path = base_path('.env');
            if (!file_exists($path)) return;

            $content = file_get_contents($path);

            // Escape value for .env (wrap in quotes if contains spaces or special chars)
            $safeValue = strpos($value, ' ') !== false || strpos($value, '$') !== false ? "\"$value\"" : $value;

            if (preg_match("/^{$key}=/m", $content)) {
                $content = preg_replace("/^{$key}=.*/m", "{$key}={$safeValue}", $content);
            } else {
                $content .= "\n{$key}={$safeValue}";
            }

            @file_put_contents($path, $content);
        } catch (\Exception $e) {
            // Log or ignore - if permission denied, settings still save to DB
            \Illuminate\Support\Facades\Log::warning("Failed to update .env key {$key}: " . $e->getMessage());
        }
    }

    public function setupPaymentDomain(Request $request, \App\Services\DnsService $dnsService, \App\Services\ShellService $shell, \App\Services\NginxConfigService $nginxService)
    {
        $primaryDomain = Setting::get('ns_default_domain');
        if (empty($primaryDomain)) {
            return response()->json(['message' => 'Primary domain (ns_default_domain) is not configured.'], 400);
        }
        $primaryDomain = rtrim($primaryDomain, '.');
        $paymentDomain = "payment.{$primaryDomain}";
        $serverIp = Setting::get('server_ip', '127.0.0.1');

        // 1. Setup DNS A record
        $domainRecord = \App\Models\Domain::where('domain', $primaryDomain)->first();
        if ($domainRecord) {
            \App\Models\DnsRecord::firstOrCreate([
                'domain_id' => $domainRecord->id,
                'type' => 'A',
                'name' => 'payment',
                'value' => $serverIp
            ], [
                'ttl' => 3600
            ]);
            $dnsService->syncRecords($domainRecord);
        }

        // 2. Setup Nginx block using stub template
        $baseDir = realpath(base_path('..'));
        $frontendDist = "{$baseDir}/frontend/dist";
        $backendPublic = "{$baseDir}/backend/public";
        $phpFpmSock = config('hosting.php_fpm_sock', '/var/run/php/php8.4-fpm.sock');

        $sitesAvailable = '/etc/nginx/sites-available';
        $sitesEnabled   = '/etc/nginx/sites-enabled';
        $configFile     = "{$sitesAvailable}/{$paymentDomain}";
        $symlinkFile    = "{$sitesEnabled}/{$paymentDomain}";

        // Read base HTTP stub
        $httpStubPath = resource_path('nginx-templates/payment.conf.stub');
        $httpStub = file_get_contents($httpStubPath);

        $placeholders = ['{{domain}}', '{{frontend_dist}}', '{{backend_public}}', '{{php_fpm_sock}}'];
        $replacements = [$paymentDomain, $frontendDist, $backendPublic, $phpFpmSock];
        $httpConfig = str_replace($placeholders, $replacements, $httpStub);

        $escapedConfig = escapeshellarg($httpConfig);
        $shell->run("echo {$escapedConfig} | sudo tee {$configFile} > /dev/null");
        $shell->run("sudo ln -sf {$configFile} {$symlinkFile}");
        $shell->run("sudo nginx -t && sudo nginx -s reload");

        // 3. Procure SSL via certbot directly (certonly so it doesn't mangle config)
        $shell->run("sudo certbot certonly --nginx -d {$paymentDomain} --non-interactive --agree-tos --register-unsafely-without-email");

        // 4. Generate SSL specific config if certificate was procured
        if ($nginxService->hasCertificate($paymentDomain)) {
            // Overwrite HTTP config with redirect
            $redirectConfig = "server {\n" .
                "    listen 80;\n" .
                "    listen [::]:80;\n" .
                "    server_name {$paymentDomain};\n" .
                "    return 301 https://\$host\$request_uri;\n" .
                "}\n";
            $escapedRedirect = escapeshellarg($redirectConfig);
            $shell->run("echo {$escapedRedirect} | sudo tee {$configFile} > /dev/null");

            // Generate SSL config
            $sslStubPath = resource_path('nginx-templates/payment-ssl.conf.stub');
            $sslStub = file_get_contents($sslStubPath);
            $sslConfig = str_replace($placeholders, $replacements, $sslStub);

            $sslConfigFile = "{$sitesAvailable}/{$paymentDomain}-ssl";
            $sslSymlinkFile = "{$sitesEnabled}/{$paymentDomain}-ssl";
            $escapedSslConfig = escapeshellarg($sslConfig);

            $shell->run("echo {$escapedSslConfig} | sudo tee {$sslConfigFile} > /dev/null");
            $shell->run("sudo ln -sf {$sslConfigFile} {$sslSymlinkFile}");
            $shell->run("sudo nginx -t && sudo nginx -s reload");
        }

        $url = "https://{$paymentDomain}";
        Setting::set('payment_callback_base_url', $url);

        return response()->json([
            'message' => "Payment domain {$paymentDomain} configured successfully with landing redirect to /subscription.",
            'url' => $url
        ]);
    }

    public function setupApiDomain(Request $request, \App\Services\DnsService $dnsService, \App\Services\ShellService $shell, \App\Services\NginxConfigService $nginxService)
    {
        $primaryDomain = Setting::get('ns_default_domain');
        if (empty($primaryDomain)) {
            return response()->json(['message' => 'Primary domain (ns_default_domain) is not configured.'], 400);
        }
        $primaryDomain = rtrim($primaryDomain, '.');
        $apiDomain = "api.{$primaryDomain}";
        $serverIp = Setting::get('server_ip', '127.0.0.1');

        // 1. Setup DNS A record
        $domainRecord = \App\Models\Domain::where('domain', $primaryDomain)->first();
        if ($domainRecord) {
            \App\Models\DnsRecord::firstOrCreate([
                'domain_id' => $domainRecord->id,
                'type' => 'A',
                'name' => 'api',
                'value' => $serverIp
            ], [
                'ttl' => 3600
            ]);
            $dnsService->syncRecords($domainRecord);
        }

        // 2. Setup Nginx block using stub template
        $baseDir = realpath(base_path('..'));
        $frontendDist = "{$baseDir}/frontend/dist";
        $backendPublic = "{$baseDir}/backend/public";
        $phpFpmSock = config('hosting.php_fpm_sock', '/var/run/php/php8.4-fpm.sock');

        $sitesAvailable = '/etc/nginx/sites-available';
        $sitesEnabled   = '/etc/nginx/sites-enabled';
        $configFile     = "{$sitesAvailable}/{$apiDomain}";
        $symlinkFile    = "{$sitesEnabled}/{$apiDomain}";

        // Read base HTTP stub
        $httpStubPath = resource_path('nginx-templates/api-docs.conf.stub');
        $httpStub = file_get_contents($httpStubPath);

        $placeholders = ['{{domain}}', '{{frontend_dist}}', '{{backend_public}}', '{{php_fpm_sock}}'];
        $replacements = [$apiDomain, $frontendDist, $backendPublic, $phpFpmSock];
        $httpConfig = str_replace($placeholders, $replacements, $httpStub);

        $escapedConfig = escapeshellarg($httpConfig);
        $shell->run("echo {$escapedConfig} | sudo tee {$configFile} > /dev/null");
        $shell->run("sudo ln -sf {$configFile} {$symlinkFile}");
        $shell->run("sudo nginx -t && sudo nginx -s reload");

        // 3. Procure SSL via certbot directly
        $shell->run("sudo certbot certonly --nginx -d {$apiDomain} --non-interactive --agree-tos --register-unsafely-without-email");

        // 4. Generate SSL specific config if certificate was procured
        if ($nginxService->hasCertificate($apiDomain)) {
            // Overwrite HTTP config with redirect
            $redirectConfig = "server {\n" .
                "    listen 80;\n" .
                "    listen [::]:80;\n" .
                "    server_name {$apiDomain};\n" .
                "    return 301 https://\$host\$request_uri;\n" .
                "}\n";
            $escapedRedirect = escapeshellarg($redirectConfig);
            $shell->run("echo {$escapedRedirect} | sudo tee {$configFile} > /dev/null");

            // Generate SSL config
            $sslStubPath = resource_path('nginx-templates/api-docs-ssl.conf.stub');
            $sslStub = file_get_contents($sslStubPath);
            $sslConfig = str_replace($placeholders, $replacements, $sslStub);

            $sslConfigFile = "{$sitesAvailable}/{$apiDomain}-ssl";
            $sslSymlinkFile = "{$sitesEnabled}/{$apiDomain}-ssl";
            $escapedSslConfig = escapeshellarg($sslConfig);

            $shell->run("echo {$escapedSslConfig} | sudo tee {$sslConfigFile} > /dev/null");
            $shell->run("sudo ln -sf {$sslConfigFile} {$sslSymlinkFile}");
            $shell->run("sudo nginx -t && sudo nginx -s reload");
        }

        $url = "https://{$apiDomain}";
        Setting::set('api_docs_url', $url);

        return response()->json([
            'message' => "API domain {$apiDomain} configured successfully.",
            'url' => $url
        ]);
    }
}
