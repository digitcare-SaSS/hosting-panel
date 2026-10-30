<?php

namespace App\Http\Middleware;

use App\Models\MigrationEvent;
use App\Services\Migration\MigrationKey;
use App\Services\Migration\MigrationSigner;
use App\Services\Migration\MigrationSwitch;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Guards the source-side migration endpoints: closed unless migration is switched on, and then
 * only a panel holding this server's key (from the allowed IP, if set) can call them.
 * Every JSON answer is signed back.
 */
class VerifyMigrationSignature
{
    private const MAX_FAILURES_PER_MINUTE = 10;

    public function handle(Request $request, Closure $next): Response
    {
        $limiterKey = 'migration-auth:' . $request->ip();
        if (RateLimiter::tooManyAttempts($limiterKey, self::MAX_FAILURES_PER_MINUTE)) {
            return response()->json(['error' => 'Too many failed attempts. Try again in a minute.'], 429);
        }

        if (!MigrationSwitch::isOn()) {
            return $this->reject($limiterKey, 403, 'Migration is turned off on this panel.', 'migration off');
        }

        $key = MigrationKey::active();
        if (!$key) {
            return $this->reject($limiterKey, 401, 'This panel has no active migration key (expired, revoked or already used).', 'no active key');
        }

        if ($key->allowedIp !== null && $request->ip() !== $key->allowedIp) {
            return $this->reject(
                $limiterKey,
                403,
                "This migration key is locked to a different server IP. Your server connected from {$request->ip()} - create a new key for that IP on the old panel.",
                "IP {$request->ip()} not allowed"
            );
        }

        $headers = [];
        foreach ([MigrationSigner::H_KEY_ID, MigrationSigner::H_TIMESTAMP, MigrationSigner::H_NONCE, MigrationSigner::H_SIGNATURE] as $name) {
            $headers[$name] = $request->header($name);
        }

        $reason = MigrationSigner::verifyRequest($key, $request->method(), $request->path(), $headers, $request->getContent());
        if ($reason !== null) {
            return $this->reject($limiterKey, 401, "Migration key rejected: {$reason}.", $reason);
        }

        $request->attributes->set('migration_key', $key);
        $response = $next($request);

        // File downloads are verified by the SHA-256 from the (signed) export status instead
        if (!$response instanceof BinaryFileResponse && !$response instanceof StreamedResponse) {
            $response->headers->set(
                MigrationSigner::H_SIGNATURE,
                MigrationSigner::signResponse($key, $headers[MigrationSigner::H_NONCE], (string) $response->getContent())
            );
        }

        return $response;
    }

    private function reject(string $limiterKey, int $status, string $message, string $reason): Response
    {
        RateLimiter::hit($limiterKey, 60);
        MigrationEvent::record('rejected', "Refused a connection: {$reason}");

        return response()->json(['error' => $message], $status);
    }
}
