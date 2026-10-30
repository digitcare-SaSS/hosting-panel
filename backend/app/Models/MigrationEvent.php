<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MigrationEvent extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['event', 'ip', 'details'];

    public static function record(string $event, ?string $details = null, ?string $ip = null): void
    {
        static::create(['event' => $event, 'details' => $details, 'ip' => $ip ?? request()?->ip()]);
    }
}
