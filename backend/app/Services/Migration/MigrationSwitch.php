<?php

namespace App\Services\Migration;

use App\Models\MigrationEvent;
use App\Models\MigrationExport;
use App\Models\Setting;

/**
 * Master switch for migration. Off by default: while off this panel can neither be copied
 * to another server (all source endpoints are closed) nor receive one.
 */
class MigrationSwitch
{
    public const SETTING = 'migration_enabled';

    public function __construct(private MigrationExportService $exports) {}

    public static function isOn(): bool
    {
        return Setting::get(self::SETTING) === '1';
    }

    public function turnOn(): void
    {
        Setting::set(self::SETTING, '1');
        MigrationEvent::record('enabled', 'Migration turned on');
    }

    /**
     * Close everything: revoke the key and destroy any prepared archive.
     */
    public function turnOff(string $reason = 'Migration turned off'): void
    {
        Setting::set(self::SETTING, null);
        MigrationKey::revoke();
        $this->discardExports();
        MigrationEvent::record('disabled', $reason);
    }

    /**
     * Archives are encrypted with the key they were made for - a new or revoked key makes them useless.
     */
    public function discardExports(): void
    {
        MigrationExport::where('status', 'completed')->get()
            ->each(fn (MigrationExport $e) => $this->exports->discard($e, 'expired'));
        MigrationExport::where('status', 'failed')->update(['status' => 'expired']);
    }
}
