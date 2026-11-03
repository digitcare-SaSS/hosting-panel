<?php

namespace App\Services;

use App\Models\App;
use App\Models\Deployment;
use App\Models\Customer;
use App\Models\CustomerDeployment;
use App\Models\LoadBalancer;
use Illuminate\Support\Facades\Http;

class DeploymentService
{
    // Turbopack compile + TypeScript check can take well over 10 minutes on a small VPS
    private const BUILD_TIMEOUT = 1800;

    public function __construct(
        private ShellService $shell,
        private PortAssignmentService $portService,
        private NginxConfigService $nginxService,
        private PM2Service $pm2Service,
        private DnsService $dnsService,
        private SslService $sslService,
        private BackgroundServiceManager $bgServiceManager,
        private CrmApiService $crmApiService,
    ) {}

    public function createDeploymentRecord(App $app): Deployment
    {
        return Deployment::create([
            'app_id'     => $app->id,
            'status'     => 'running',
            'started_at' => now(),
        ]);
    }

    public function runLoadBalancerDeployment(Customer $customer, CustomerDeployment $deployment): void
    {
        $log = function (string $line) use ($deployment) {
            $deployment->appendLog($line);
        };

        try {
            $deployment->update(['status' => 'deploying', 'started_at' => now()]);

            // 1. DNS
            $log("[1/4] Creating DNS records for {$deployment->domain}...");
            $this->dnsService->createManagedDomain($deployment->domain);

            // 2. Load Balancer Link/Create
            $lb = LoadBalancer::findOrFail($deployment->load_balancer_id);
            $log("[2/4] Configuring Load Balancer: {$lb->name}...");

            $lbDomain = $lb->domains()->where('domain', $deployment->domain)->first();
            if (!$lbDomain) {
                $lbDomain = $lb->domains()->create([
                    'domain' => $deployment->domain,
                    'ssl_enabled' => true,
                    'force_https' => true,
                ]);
            }

            $lb->load(['apps', 'domains']);
            $this->nginxService->generateLoadBalancer($lb);

            // 3. SSL
            $log("[3/4] Provisioning SSL certificate...");
            try {
                $this->sslService->setupSsl($lbDomain);
                $log("SSL setup successful.");
            } catch (\Exception $e) {
                $log("[WARN] SSL setup failed: " . $e->getMessage());
                // Don't fail the whole deployment for SSL, user can retry SSL later
            }

            // 4. CRM API
            $log("[4/4] Synchronizing with CRM API...");
            $this->crmApiService->execute($customer, $log);

            $deployment->update(['status' => 'success', 'finished_at' => now()]);
            $customer->update(['status' => 'active', 'resource_type' => 'load_balancer', 'resource_id' => $lb->id]);
            $log("✅ Load Balancer deployment complete!");
        } catch (\Throwable $e) {
            $log("\n[ERROR] " . $e->getMessage());
            $deployment->update(['status' => 'failed', 'finished_at' => now()]);
            throw $e;
        }
    }

    public function runDeployment(App $app, Deployment $deployment, bool $zeroDowntime = false): void
    {
        try {
            if ($zeroDowntime) {
                $this->executeZeroDowntimeDeployment($app, $deployment);
            } else {
                $this->executeDeployment($app, $deployment);
            }
            $deployment->update(['status' => 'success', 'finished_at' => now()]);
            $app->update(['status' => 'running']);

            // Optional: Synchronization with CRM API if it's a CRM customer app
            $customer = Customer::where('resource_type', 'app')->where('resource_id', $app->id)->first();
            if ($customer) {
                $crmLog = function (string $line) use ($deployment) {
                    $deployment->appendLog($line);
                };
                $crmLog("\nSynchronizing with CRM API...");
                $this->crmApiService->execute($customer, $crmLog);
            }
        } catch (\Throwable $e) {
            $deployment->appendLog("\n[ERROR] " . $e->getMessage());
            $deployment->update(['status' => 'failed', 'finished_at' => now()]);
            // A failed zero-downtime deploy leaves the previous version serving traffic
            $stillLive = $zeroDowntime && $this->pm2Service->status($app) === 'online';
            $app->update(['status' => $stillLive ? 'running' : 'error']);
            throw $e;
        }
    }

    private function executeDeployment(App $app, Deployment $deployment): void
    {
        $basePath = config('hosting.apps_base_path', '/var/www/hosting-apps');
        $deployPath = "{$basePath}/{$app->domain}";

        $log = function (string $line) use ($deployment) {
            $deployment->appendLog($line);
        };

        // === Step 1: Clone or pull ===
        $log("[1/6] Cloning / pulling repository...");
        $this->syncRepository($app, $basePath, $deployPath, $log);

        // === Step 2: Write .env file ===
        $log("[2/6] Writing environment variables...");
        $this->writeEnvFile($app);

        // === Step 3: Install dependencies ===
        $log("[3/6] Installing dependencies...");

        // Ensure www-data owns the files before we try to install dependencies (important for npm/composer)
        $currentUser = trim(shell_exec('whoami'));
        if ($currentUser !== 'www-data') {
            $this->shell->run("sudo chown -R www-data:www-data " . escapeshellarg($deployPath));
        }

        if ($app->type === 'laravel') {
            $exitCode = $this->shell->stream(
                "composer install --no-interaction --prefer-dist --optimize-autoloader",
                $deployPath,
                $log,
                300
            );
        } else {
            $log("Attempting clear-cut install (npm ci)...");
            $exitCode = $this->shell->stream("npm ci --production=false", $deployPath, $log, 300);

            if ($exitCode !== 0) {
                $log("[WARN] npm ci failed (likely unsynced lock file). Falling back to npm install...");
                $exitCode = $this->shell->stream("npm install --production=false --no-audit --no-fund", $deployPath, $log, 300);
            }
        }

        if ($exitCode !== 0) {
            $errorMsg = ($app->type === 'laravel') ? "Composer installation failed" : "NPM dependency installation failed";
            throw new \RuntimeException("{$errorMsg} with exit code {$exitCode}. Check that /var/www/.npm is owned by www-data if this is an EACCES error.");
        }

        // === Step 4: Build & Bootstrap ===
        $log("[4/6] Building project and bootstrapping...");
        if ($app->type === 'nextjs') {
            $exitCode = $this->shell->stream("npm run build", $deployPath, $log, self::BUILD_TIMEOUT);
            if ($exitCode !== 0) {
                throw new \RuntimeException("Next.js build failed");
            }
        } elseif ($app->type === 'laravel') {
            $this->bootstrapLaravel($app, $deployPath, $log);
            $this->shell->stream("php artisan migrate --force", $deployPath, $log);
            $this->shell->stream("php artisan optimize", $deployPath, $log);
        }

        // === Step 5: Assign port (Next.js only) ===
        $log("[5/6] Configuring port and Nginx...");
        if ($app->type === 'nextjs') {
            if (!$app->port) {
                $port = $this->portService->assignPort();
                $app->update(['port' => $port]);
                $app->refresh();
            }
        }

        // === Step 6: Nginx config ===
        $this->nginxService->generate($app);

        // === Step 7: Finalize Permissions & Start ===
        $log("[6/6] Finalizing permissions and starting...");

        // Final recursive chown and permission fix to ensure www-data can write to everything
        // Optimization: Skip recursive chown if we are already running as www-data
        $currentUser = trim(shell_exec('whoami'));
        if ($currentUser !== 'www-data') {
            $this->shell->run("sudo chown -R www-data:www-data " . escapeshellarg($deployPath));
        }

        if ($app->type === 'laravel') {
            // Only chmod the directories that actually need it, faster than the whole tree
            $this->shell->run("sudo chmod -R 775 " . escapeshellarg("{$deployPath}/storage") . " " . escapeshellarg("{$deployPath}/bootstrap/cache"));
        }

        if ($app->type === 'nextjs') {
            // Stop existing PM2 process if any (including blue/green slots from zero-downtime deploys)
            $this->pm2Service->deleteAll($app);
            $app->update(['active_slot' => null]);
            $result = $this->pm2Service->start($app);
            if ($result['exit_code'] !== 0) {
                throw new \RuntimeException("PM2 start failed: " . $result['output']);
            }
            $this->pm2Service->save();
        }

        $dnsOutput = $this->dnsService->reloadBind($app->domainRecord);
        $log($dnsOutput);

        // === Step 9: SSL Setup (New) ===
        if ($app->ssl_enabled) {
            $log("[SSL] Re-verifying SSL setup...");
            $sslResult = $this->sslService->setupSsl($app);
            $log($sslResult['message']);
        }

        // === Step 10: Install recommended background services ===
        $log("[BG] Registering recommended background services...");
        try {
            $this->bgServiceManager->installRecommended($app);
            $log("[BG] Background services registered. Start them from the Services tab.");
        } catch (\Throwable $e) {
            $log("[BG] Warning: could not register background services: " . $e->getMessage());
        }

        $log("✅ Deployment complete! Domain: {$app->domain}");
    }

    /**
     * Blue/green deploy for Next.js: build in an idle release directory, boot it on the standby
     * port, health-check it, then point Nginx at it with a graceful reload. The live version keeps
     * serving traffic until the switch, and stays live if any step before the switch fails.
     */
    private function executeZeroDowntimeDeployment(App $app, Deployment $deployment): void
    {
        if ($app->type !== 'nextjs') {
            throw new \RuntimeException("Zero-downtime deployment is only supported for Next.js apps");
        }

        $basePath = config('hosting.apps_base_path', '/var/www/hosting-apps');
        $deployPath = "{$basePath}/{$app->domain}";

        $log = function (string $line) use ($deployment) {
            $deployment->appendLog($line);
        };

        // `command` is a shell builtin; ShellService prefixes `env -i`, which can only exec binaries,
        // so the lookup must run inside a shell.
        $rsyncCheck = $this->shell->run("sh -c 'command -v rsync'");
        if ($rsyncCheck['exit_code'] !== 0) {
            throw new \RuntimeException(sprintf(
                "rsync is required for zero-downtime deployments. Install it with: sudo apt-get install -y rsync (lookup exit code %s, PATH=%s, output: %s)",
                $rsyncCheck['exit_code'],
                getenv('PATH') ?: '(empty, using default)',
                trim($rsyncCheck['output']) ?: '(none)'
            ));
        }

        // === Step 1: Clone or pull (source only, the live process runs from a release directory) ===
        $log("[1/8] Cloning / pulling repository...");
        $this->syncRepository($app, $basePath, $deployPath, $log);

        // === Step 2: Ports & slots ===
        if (!$app->port) {
            $app->update(['port' => $this->portService->assignPort()]);
        }
        if (!$app->standby_port) {
            $app->update(['standby_port' => $this->portService->assignPort()]);
        }
        $app->refresh();

        $liveSlot   = $app->active_slot;
        $targetSlot = $liveSlot === 'blue' ? 'green' : 'blue';
        $liveDir    = $liveSlot ? $app->releasePath($liveSlot) : $deployPath;
        $targetDir  = $app->releasePath($targetSlot);
        $livePort   = $app->port;
        $targetPort = $app->standby_port;
        $liveName   = $app->processName($liveSlot);
        $targetName = $app->processName($targetSlot);

        $log("[2/8] Writing environment variables...");
        $this->writeEnvFile($app);
        $log("Live: {$liveName} on port {$livePort}. Building {$targetSlot} release for port {$targetPort}.");

        // Clear a leftover standby process from an earlier failed attempt
        $this->pm2Service->deleteProcess($targetName);

        // === Step 3: Sync source into the idle release ===
        $log("[3/8] Preparing {$targetSlot} release...");
        @mkdir($targetDir, 0755, true);
        $exitCode = $this->shell->stream(
            "rsync -a --delete --exclude=/.git --exclude=/node_modules --exclude=/.next "
                . escapeshellarg("{$deployPath}/") . " " . escapeshellarg("{$targetDir}/"),
            $basePath,
            $log
        );
        if ($exitCode !== 0) {
            throw new \RuntimeException("Copying source into release directory failed with exit code {$exitCode}");
        }

        // Link the managed env file so edits from the Environment tab apply on restart
        $envName = basename($app->getEnvFilePath());
        if (file_exists("{$deployPath}/{$envName}")) {
            $this->shell->run("ln -sfn " . escapeshellarg("{$deployPath}/{$envName}") . " " . escapeshellarg("{$targetDir}/{$envName}"));
        }

        // === Step 4: Dependencies (reuse live node_modules when the lockfile is unchanged) ===
        $log("[4/8] Installing dependencies...");
        $depsHash = $this->dependencyHash($targetDir);
        $markerFile = "node_modules/.panel-deps-hash";
        $cachedHash = @file_get_contents("{$liveDir}/{$markerFile}") ?: null;

        if (is_dir("{$liveDir}/node_modules")) {
            $log("Restoring node_modules cache from live release...");
            $this->shell->stream(
                "rsync -a --delete " . escapeshellarg("{$liveDir}/node_modules/") . " " . escapeshellarg("{$targetDir}/node_modules/"),
                $basePath,
                $log,
                600
            );
        }

        $currentUser = trim(shell_exec('whoami'));
        if ($currentUser !== 'www-data') {
            $this->shell->run("sudo chown -R www-data:www-data " . escapeshellarg($targetDir));
        }

        if ($cachedHash !== null && $cachedHash === $depsHash) {
            $log("Dependencies unchanged - reusing cached node_modules.");
        } else {
            $exitCode = $this->shell->stream("npm install --production=false --prefer-offline --no-audit --no-fund", $targetDir, $log, 300);
            if ($exitCode !== 0) {
                $log("[WARN] Incremental npm install failed. Falling back to clean install (npm ci)...");
                $exitCode = $this->shell->stream("npm ci --production=false --prefer-offline", $targetDir, $log, 300);
            }
            if ($exitCode !== 0) {
                throw new \RuntimeException("NPM dependency installation failed with exit code {$exitCode}. The live version was not touched.");
            }
            file_put_contents("{$targetDir}/{$markerFile}", $depsHash);
        }

        // === Step 5: Build with the previous build cache ===
        $log("[5/8] Building project...");
        if (is_dir("{$liveDir}/.next/cache")) {
            $log("Restoring Next.js build cache from live release...");
            @mkdir("{$targetDir}/.next", 0755, true);
            $this->shell->stream(
                "rsync -a --delete " . escapeshellarg("{$liveDir}/.next/cache/") . " " . escapeshellarg("{$targetDir}/.next/cache/"),
                $basePath,
                $log,
                600
            );
        }

        $exitCode = $this->shell->stream("npm run build", $targetDir, $log, self::BUILD_TIMEOUT);
        if ($exitCode !== 0) {
            throw new \RuntimeException("Next.js build failed. The live version was not touched.");
        }

        if ($currentUser !== 'www-data') {
            $this->shell->run("sudo chown -R www-data:www-data " . escapeshellarg($targetDir));
        }

        // === Step 6: Boot the new release on the standby port and health-check it ===
        $log("[6/8] Starting {$targetName} on port {$targetPort}...");
        $result = $this->pm2Service->startProcess($targetName, $targetDir, $targetPort);
        if ($result['exit_code'] !== 0) {
            $this->pm2Service->deleteProcess($targetName);
            throw new \RuntimeException("PM2 start failed: " . $result['output']);
        }

        if (!$this->waitUntilHealthy($targetPort, $log)) {
            $log($this->pm2Service->processLogs($targetName, 40));
            $this->pm2Service->deleteProcess($targetName);
            throw new \RuntimeException("New release did not become healthy on port {$targetPort}. The live version was not touched.");
        }

        // === Step 7: Switch traffic ===
        $log("[7/8] Switching traffic to {$targetSlot} release...");
        $nginxTest = $this->shell->run("sudo nginx -t");
        if ($nginxTest['exit_code'] !== 0) {
            $this->pm2Service->deleteProcess($targetName);
            throw new \RuntimeException("Nginx config test failed, traffic was not switched: " . $nginxTest['output']);
        }

        $app->update([
            'port'         => $targetPort,
            'standby_port' => $livePort,
            'active_slot'  => $targetSlot,
        ]);
        $app->refresh();

        foreach ($app->loadBalancers as $lb) {
            $this->nginxService->generateAppInternalConfig($app, $lb, 60000 + $app->id);
        }
        $this->nginxService->generate($app);
        $this->nginxService->generateSsl($app);
        $this->writeEnvFile($app);
        $this->pm2Service->save();

        // === Step 8: Drain and retire the old release ===
        $log("[8/8] Draining in-flight requests, then stopping {$liveName}...");
        sleep(10);
        $this->pm2Service->deleteProcess($liveName);
        $this->pm2Service->save();

        $dnsOutput = $this->dnsService->reloadBind($app->domainRecord);
        $log($dnsOutput);

        $log("[BG] Registering recommended background services...");
        try {
            $this->bgServiceManager->installRecommended($app);
            $log("[BG] Background services registered. Start them from the Services tab.");
        } catch (\Throwable $e) {
            $log("[BG] Warning: could not register background services: " . $e->getMessage());
        }

        $log("✅ Zero-downtime deployment complete! {$app->domain} is now served by {$targetName} on port {$targetPort}.");
    }

    private function dependencyHash(string $dir): string
    {
        $content = '';
        foreach (['package.json', 'package-lock.json', 'npm-shrinkwrap.json'] as $file) {
            if (file_exists("{$dir}/{$file}")) {
                $content .= $file . "\0" . file_get_contents("{$dir}/{$file}") . "\0";
            }
        }
        return hash('sha256', $content);
    }

    /**
     * Any HTTP response below 500 counts as healthy (apps may redirect or 404 on "/").
     */
    private function waitUntilHealthy(int $port, \Closure $log, int $timeoutSeconds = 60): bool
    {
        $deadline = time() + $timeoutSeconds;
        while (time() < $deadline) {
            try {
                $response = Http::timeout(5)->withoutRedirecting()->get("http://127.0.0.1:{$port}/");
                if ($response->status() < 500) {
                    $log("Health check passed (HTTP {$response->status()}).");
                    return true;
                }
                $log("Health check got HTTP {$response->status()}, retrying...");
            } catch (\Throwable $e) {
                // Not listening yet
            }
            sleep(2);
        }
        return false;
    }

    private function syncRepository(App $app, string $basePath, string $deployPath, \Closure $log): void
    {
        // Fix: Mark directory as safe for git to avoid "dubious ownership" errors
        $this->shell->run("git config --global --add safe.directory " . escapeshellarg($deployPath));

        $gitUrl = $app->git_url;

        // If this app is linked to the panel's GitHub integration, inject the token to allow cloning private repos
        if ($app->github_id || $app->github_full_name) {
            $token = \App\Models\Setting::get('github_access_token');
            if ($token && preg_match('#^https://github\.com/#', $gitUrl)) {
                $log("Authorized GitHub app detected. Injecting access token into clone URL...");
                // x-access-token is the standard username for GitHub Apps/OAuth tokens in URLs
                $gitUrl = preg_replace('#^https://github\.com/#', "https://x-access-token:{$token}@github.com/", $gitUrl);
            }
        }

        if (is_dir("{$deployPath}/.git")) {
            // Ensure remote URL has the token (or is updated if it changed)
            $this->shell->run("git -C " . escapeshellarg($deployPath) . " remote set-url origin " . escapeshellarg($gitUrl));
            $exitCode = $this->shell->stream("git pull origin " . escapeshellarg($app->branch), $deployPath, $log);
        } else {
            @mkdir($deployPath, 0755, true);
            $cloneCmd = "git clone --branch " . escapeshellarg($app->branch) . " --depth 1 " . escapeshellarg($gitUrl) . " " . escapeshellarg($deployPath);
            $exitCode = $this->shell->stream($cloneCmd, $basePath, $log);
        }
        if ($exitCode !== 0) {
            throw new \RuntimeException("Git clone/pull failed with exit code {$exitCode}");
        }

        // Save deploy path
        $app->update(['deploy_path' => $deployPath]);
    }

    private function bootstrapLaravel(App $app, string $deployPath, \Closure $log): void
    {
        $log("Bootstrapping Laravel filesystem and environment...");

        // Ensure critical storage subdirectories exist
        $directories = [
            "{$deployPath}/storage/app/public",
            "{$deployPath}/storage/framework/cache",
            "{$deployPath}/storage/framework/sessions",
            "{$deployPath}/storage/framework/views",
            "{$deployPath}/storage/logs",
            "{$deployPath}/bootstrap/cache",
        ];

        foreach ($directories as $dir) {
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
        }

        // Generate APP_KEY if it's not already in the .env or if it's the default
        $envFile = $app->getEnvFilePath();
        $envContent = file_get_contents($envFile);
        if (!str_contains($envContent, 'APP_KEY=base64:')) {
            // Ensure the placeholder exists, otherwise key:generate fails
            if (!str_contains($envContent, 'APP_KEY=')) {
                $log("Adding APP_KEY placeholder to " . basename($envFile) . "...");
                file_put_contents($envFile, $envContent . "\nAPP_KEY=\n");
            }

            $log("Generating new application key...");
            $result = $this->shell->run("php artisan key:generate --force", $deployPath);
            if ($result['exit_code'] !== 0) {
                $log("[WARN] Key generation failed: " . $result['output']);
            }
        }

        // Link storage
        $result = $this->shell->run("php artisan storage:link", $deployPath);
        if ($result['exit_code'] !== 0) {
            $log("[WARN] Storage link failed: " . $result['output']);
        }
    }

    public function writeEnvFile(App $app): void
    {
        if (!$app->deploy_path) {
            return;
        }

        $deployPath = $app->deploy_path;
        $envFile = $app->getEnvFilePath();
        $envFileName = basename($envFile);

        // 1. If the environment file doesn't exist, try to template it from an example file
        if (!file_exists($envFile)) {
            $templateFile = null;

            // Scan for example files using regex
            $files = is_dir($deployPath) ? scandir($deployPath) : [];
            $regex = '/^\.env\.(example|sample|demo|template|dist)$|^\.env-example$/i';
            $exampleFiles = preg_grep($regex, $files);

            if (!empty($exampleFiles)) {
                $templateFile = reset($exampleFiles);
            } else {
                // Fallback: search for any file containing ".env" except the target file itself
                $fallbackRegex = '/\.env/i';
                $fallbackFiles = preg_grep($fallbackRegex, $files);
                foreach ($fallbackFiles as $file) {
                    if ($file !== $envFileName) {
                        $templateFile = $file;
                        break;
                    }
                }
            }

            if ($templateFile && file_exists("{$deployPath}/{$templateFile}")) {
                $this->shell->run("cp " . escapeshellarg("{$deployPath}/{$templateFile}") . " " . escapeshellarg($envFile));
            }
        }

        // 2. Ensure mandatory and database variables using non-destructive regex
        if (file_exists($envFile)) {
            $content = file_get_contents($envFile);
            $varsToUpdate = [];

            if ($app->type === 'nextjs' && $app->port) {
                $varsToUpdate['PORT'] = $app->port;
            }
            if ($app->type === 'laravel') {
                $varsToUpdate['APP_KEY'] = ''; // Ensure placeholder exists if missing
            }

            // Inject Database credentials if any associated databases exist
            $db = $app->databases()->first();
            if ($db) {
                $varsToUpdate = array_merge($varsToUpdate, [
                    'DB_CONNECTION' => 'pgsql',
                    'DB_HOST'       => '127.0.0.1',
                    'DB_PORT'       => '5432',
                    'DB_DATABASE'   => $db->db_name,
                    'DB_USERNAME'   => $db->db_user,
                    'DB_PASSWORD'   => $db->db_password,
                ]);
            }

            if (!empty($varsToUpdate)) {
                $updated = false;
                foreach ($varsToUpdate as $key => $value) {
                    $pattern = "/^(\s*#?\s*)" . preg_quote($key, '/') . "=.*/m";
                    if (preg_match($pattern, $content)) {
                        $content = preg_replace($pattern, "{$key}={$value}", $content);
                        $updated = true;
                    } else {
                        // Key missing entirely. Append it.
                        $content .= (empty($content) || str_ends_with($content, "\n") ? "" : "\n") . "{$key}={$value}\n";
                        $updated = true;
                    }
                }

                if ($updated) {
                    file_put_contents($envFile, $content);
                }
            }
        }
    }
}
