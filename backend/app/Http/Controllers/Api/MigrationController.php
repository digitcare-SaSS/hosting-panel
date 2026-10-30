<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\MigrateFromServer;
use App\Models\MigrationEvent;
use App\Models\MigrationExport;
use App\Services\Migration\MigrationClient;
use App\Services\Migration\MigrationKey;
use App\Services\Migration\MigrationState;
use App\Services\Migration\MigrationSwitch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class MigrationController extends Controller
{
    private const CONFIRMATION_MINUTES = 10;

    public function __construct(
        private MigrationState $state,
        private MigrationSwitch $switch,
    ) {}

    /**
     * Status of both roles: this panel as the old server (key + export) and as the new one (incoming).
     */
    public function index(Request $request)
    {
        $key = MigrationKey::active();
        $export = MigrationExport::latest('id')->first();
        $incoming = $this->state->progress();

        return response()->json([
            'enabled' => MigrationSwitch::isOn(),
            // What the old server should lock its key to when this panel is the new server
            'server_ip' => \App\Models\Setting::get('server_ip') ?: env('SERVER_IP'),
            'source' => [
                'key_active' => $key !== null,
                'key_expires_at' => $key ? date('c', $key->expiresAt) : null,
                'key_allowed_ip' => $key?->allowedIp,
                // The key itself is only ever returned once, when it is created
                'key_url' => $key?->url,
                'export' => $export ? [
                    'status' => $export->status,
                    'size_bytes' => $export->size_bytes,
                    'error' => $export->error,
                    'updated_at' => $export->updated_at,
                ] : null,
            ],
            'target' => $incoming ? [
                'status' => $incoming['status'],
                'source' => $incoming['source'] ?? null,
                'started_at' => $incoming['started_at'] ?? null,
            ] : null,
            'events' => MigrationEvent::latest('id')->limit(15)->get(['id', 'event', 'ip', 'details', 'created_at']),
        ]);
    }

    /**
     * Re-enter the admin password before sensitive actions (valid for a few minutes).
     */
    public function confirmPassword(Request $request)
    {
        $validated = $request->validate(['password' => 'required|string']);

        if (!Hash::check($validated['password'], $request->user()->password)) {
            MigrationEvent::record('password_failed', 'Wrong password entered for a migration action');
            return response()->json(['error' => 'Wrong password.'], 422);
        }

        Cache::put($this->confirmationKey($request), true, now()->addMinutes(self::CONFIRMATION_MINUTES));

        return response()->json(['message' => 'Password confirmed']);
    }

    /**
     * The master switch. Turning it on needs the password; turning it off never does.
     */
    public function setEnabled(Request $request)
    {
        $validated = $request->validate(['enabled' => 'required|boolean']);

        if ($validated['enabled']) {
            if ($denied = $this->requireConfirmation($request)) {
                return $denied;
            }
            $this->switch->turnOn();
        } else {
            $this->switch->turnOff();
        }

        return response()->json(['enabled' => MigrationSwitch::isOn()]);
    }

    // ── Old server ───────────────────────────────────────────────────────────

    public function generateKey(Request $request)
    {
        if ($denied = $this->requireEnabled() ?? $this->requireConfirmation($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'hours' => ['nullable', 'integer', Rule::in(MigrationKey::ALLOWED_TTL_HOURS)],
            'allowed_ip' => 'nullable|ip',
        ]);

        if (MigrationExport::whereIn('status', ['pending', 'running'])->exists()) {
            return response()->json(['error' => 'A new server is pulling this one right now. Wait until it finishes.'], 409);
        }

        $hours = (int) ($validated['hours'] ?? 6);
        $this->switch->discardExports();
        // The address the admin uses to reach this panel is the best guess for what the new server can reach
        $key = MigrationKey::generate($request->getSchemeAndHttpHost(), $hours, $validated['allowed_ip'] ?? null);
        MigrationEvent::record('key_created', sprintf(
            'Migration key created (valid %d h%s)',
            $hours,
            $key->allowedIp ? ", only for {$key->allowedIp}" : ''
        ));

        return response()->json($this->keyPayload($key), 201);
    }

    public function revokeKey()
    {
        MigrationKey::revoke();
        $this->switch->discardExports();
        MigrationEvent::record('key_revoked', 'Migration key revoked');

        return response()->json(['message' => 'Migration key revoked']);
    }

    // ── New server ───────────────────────────────────────────────────────────

    /**
     * Validate the key against the old panel and show what will be migrated.
     */
    public function connect(Request $request)
    {
        if ($denied = $this->requireEnabled()) {
            return $denied;
        }

        $validated = $request->validate([
            'key' => 'required|string|max:2000',
            'url' => 'nullable|url|max:255',
        ]);

        try {
            $key = MigrationKey::parse($validated['key']);
            $key = $key->withUrl($validated['url'] ?? $key->url);
            $info = (new MigrationClient($key))->handshake();
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json([
            'url' => $key->url,
            'expires_at' => date('c', $key->expiresAt),
            'source' => $info,
        ]);
    }

    public function start(Request $request)
    {
        if ($denied = $this->requireEnabled() ?? $this->requireConfirmation($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'key' => 'required|string|max:2000',
            'url' => 'required|url|max:255',
            'confirm' => 'required|in:MIGRATE',
        ]);

        if ($this->state->isRunning()) {
            return response()->json(['error' => 'A migration is already running on this server.'], 409);
        }

        try {
            $key = MigrationKey::parse($validated['key'])->withUrl($validated['url']);
            $info = (new MigrationClient($key))->handshake();
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $token = $this->state->begin([
            'url' => $key->url,
            'hostname' => $info['hostname'] ?? null,
        ]);
        MigrationEvent::record('migration_started', "Started pulling everything from {$key->url}");
        MigrateFromServer::dispatch($key->url, Crypt::encryptString($validated['key']));

        return response()->json(['token' => $token], 202);
    }

    /**
     * Public: the admin's session dies when the restore swaps the panel database,
     * so progress is authorised by the token handed out when the migration started.
     */
    public function progress(Request $request)
    {
        $token = (string) $request->query('token', '');
        if ($token === '' || !$this->state->tokenMatches($token)) {
            return response()->json(['error' => 'Unknown migration'], 404);
        }

        return response()->json($this->state->progress());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function keyPayload(MigrationKey $key): array
    {
        return [
            'key' => $key->toString(),
            'url' => $key->url,
            'expires_at' => date('c', $key->expiresAt),
            'allowed_ip' => $key->allowedIp,
        ];
    }

    private function requireEnabled(): ?JsonResponse
    {
        return MigrationSwitch::isOn()
            ? null
            : response()->json(['error' => 'Migration is turned off on this panel. Turn it on first.', 'code' => 'migration_off'], 403);
    }

    private function requireConfirmation(Request $request): ?JsonResponse
    {
        return $this->isConfirmed($request)
            ? null
            : response()->json(['error' => 'Confirm your password to continue.', 'code' => 'password_confirmation_required'], 423);
    }

    private function isConfirmed(Request $request): bool
    {
        return (bool) Cache::get($this->confirmationKey($request));
    }

    private function confirmationKey(Request $request): string
    {
        return 'migration-password-confirmed:' . $request->user()->getAuthIdentifier();
    }
}
