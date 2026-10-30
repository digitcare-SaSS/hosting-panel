<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MigrationExport extends Model
{
    protected $fillable = [
        'status',
        'filename',
        'local_path',
        'size_bytes',
        'sha256',
        'log_output',
        'error',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'size_bytes' => 'integer',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    protected $hidden = ['local_path'];

    public function isActive(): bool
    {
        return in_array($this->status, ['pending', 'running'], true);
    }

    public function appendLog(string $line): void
    {
        $this->log_output = ($this->log_output ?? '') . $line . "\n";
        $this->save();
    }

    public function markFailed(string $message): void
    {
        $this->appendLog("\n[ERROR] " . $message);
        $this->update(['status' => 'failed', 'error' => $message, 'finished_at' => now()]);
    }
}
