<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\CreateMigrationExport;
use App\Models\App;
use App\Models\CronJob;
use App\Models\Database;
use App\Models\Domain;
use App\Models\EmailAccount;
use App\Models\LoadBalancer;
use App\Models\MigrationEvent;
use App\Models\MigrationExport;
use App\Services\Migration\MigrationExportService;
use App\Services\Migration\MigrationSwitch;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

/**
 * Endpoints the NEW panel calls on this (old) panel. Every request is authenticated by
 * VerifyMigrationSignature with this panel's migration key.
 */
class MigrationSourceController extends Controller
{
    public function handshake()
    {
        MigrationEvent::record('connected', 'A new server connected with the migration key');

        return response()->json([
            'hostname' => gethostname(),
            'server_ip' => \App\Models\Setting::get('server_ip'),
            'panel_version' => $this->panelVersion(),
            'counts' => [
                'apps' => App::count(),
                'databases' => Database::count(),
                'domains' => Domain::count(),
                'email_accounts' => EmailAccount::count(),
                'load_balancers' => LoadBalancer::count(),
                'cron_jobs' => CronJob::count(),
            ],
        ]);
    }

    public function startExport(Request $request)
    {
        $existing = MigrationExport::whereIn('status', ['pending', 'running', 'completed'])->latest('id')->first();
        if ($existing) {
            return response()->json($this->exportPayload($existing));
        }

        $key = $request->attributes->get('migration_key');
        $export = MigrationExport::create(['status' => 'pending']);
        MigrationEvent::record('export_started', 'The new server asked for a full copy - packing started');
        CreateMigrationExport::dispatch($export, Crypt::encryptString($key->archivePassphrase()));

        return response()->json($this->exportPayload($export), 201);
    }

    public function exportStatus()
    {
        $export = MigrationExport::latest('id')->first();
        if (!$export) {
            return response()->json(['error' => 'No export has been started.'], 404);
        }

        return response()->json($this->exportPayload($export));
    }

    public function download()
    {
        $export = MigrationExport::where('status', 'completed')->latest('id')->first();
        if (!$export || !$export->local_path || !is_file($export->local_path)) {
            return response()->json(['error' => 'No archive is ready for download.'], 404);
        }

        set_time_limit(0);

        // BinaryFileResponse honours Range headers, so an interrupted transfer can resume
        return response()->download($export->local_path, $export->filename, ['Content-Type' => 'application/octet-stream']);
    }

    /**
     * The new panel has the archive: delete it here, retire the key (single-use) and switch migration off.
     */
    public function complete(MigrationExportService $service, MigrationSwitch $switch)
    {
        $export = MigrationExport::where('status', 'completed')->latest('id')->first();
        if ($export) {
            $service->discard($export, 'transferred');
        }
        MigrationEvent::record('transferred', 'The new server received the full copy - archive deleted');
        $switch->turnOff('Turned off automatically after the transfer');

        return response()->json(['message' => 'Transfer confirmed. The archive was deleted and migration switched off.']);
    }

    private function exportPayload(MigrationExport $export): array
    {
        return [
            'id' => $export->id,
            'status' => $export->status,
            'filename' => $export->filename,
            'size_bytes' => $export->size_bytes,
            'sha256' => $export->sha256,
            'error' => $export->error,
            'log' => $export->log_output ?? '',
        ];
    }

    private function panelVersion(): ?string
    {
        $head = base_path('../.git/HEAD');
        if (!is_file($head)) {
            return null;
        }
        $ref = trim(file_get_contents($head));
        if (str_starts_with($ref, 'ref: ')) {
            $refFile = base_path('../.git/' . substr($ref, 5));
            return is_file($refFile) ? substr(trim(file_get_contents($refFile)), 0, 12) : null;
        }

        return substr($ref, 0, 12);
    }
}
