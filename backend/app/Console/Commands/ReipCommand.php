<?php

namespace App\Console\Commands;

use App\Models\DnsRecord;
use App\Models\Domain;
use App\Models\Setting;
use App\Services\DnsService;
use Illuminate\Console\Command;

class ReipCommand extends Command
{
    protected $signature   = 'app:reip {old : The previous server IP} {new : The new server IP}';
    protected $description = 'Replace the server IP in panel settings and DNS records, then regenerate BIND zones (used after migrating to a new server)';

    public function handle(DnsService $dnsService)
    {
        $old = $this->argument('old');
        $new = $this->argument('new');

        foreach ([$old, $new] as $ip) {
            if (!filter_var($ip, FILTER_VALIDATE_IP)) {
                $this->error("Invalid IP address: {$ip}");
                return 1;
            }
        }

        if (in_array(Setting::get('server_ip'), [null, '', $old], true)) {
            Setting::set('server_ip', $new);
            $this->info("server_ip setting -> {$new}");
        }

        // Match the IP only as a whole token so 1.2.3.4 never rewrites 11.2.3.45
        $pattern = '/(?<![\d.])' . preg_quote($old, '/') . '(?![\d])/';
        $updated = 0;
        DnsRecord::where('value', 'like', "%{$old}%")->each(function (DnsRecord $record) use ($pattern, $new, &$updated) {
            $value = preg_replace($pattern, $new, $record->value);
            if ($value !== $record->value) {
                $record->update(['value' => $value]);
                $updated++;
            }
        });
        $this->info("Updated {$updated} DNS record(s).");

        $domains = Domain::where('dns_managed', true)->get();
        foreach ($domains as $domain) {
            $this->info("Regenerating zone: {$domain->domain}");
            try {
                $dnsService->generateZone($domain);
            } catch (\Exception $e) {
                $this->error("  Failed for {$domain->domain}: " . $e->getMessage());
            }
        }

        $this->info('IP rewrite complete.');
        return 0;
    }
}
