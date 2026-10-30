<?php

namespace App\Jobs;

use App\Models\MigrationExport;
use App\Services\Migration\MigrationExportService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Crypt;

class CreateMigrationExport implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $timeout = 7200; // 2 hours
    public $tries = 1;

    /**
     * @param string $encryptedPassphrase archive passphrase, encrypted with Crypt so the jobs table never holds it in plain text
     */
    public function __construct(
        protected MigrationExport $export,
        protected string $encryptedPassphrase
    ) {}

    public function handle(MigrationExportService $service): void
    {
        $service->create($this->export, Crypt::decryptString($this->encryptedPassphrase));
    }

    public function failed(?\Throwable $e): void
    {
        $this->export->refresh();
        if ($this->export->isActive()) {
            $this->export->markFailed($e?->getMessage() ?? 'Packing the server failed');
        }
    }
}
