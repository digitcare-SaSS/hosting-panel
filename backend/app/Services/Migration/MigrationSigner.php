<?php

namespace App\Services\Migration;

use Illuminate\Support\Facades\Cache;

/**
 * HMAC request/response signing between two panels.
 *
 * Requests carry a timestamp and a one-time nonce, so a captured request cannot be replayed.
 * Responses are signed over the request's nonce, so a captured response cannot be replayed either.
 */
class MigrationSigner
{
    public const MAX_CLOCK_SKEW = 300;

    public const H_KEY_ID = 'X-Migration-Key-Id';
    public const H_TIMESTAMP = 'X-Migration-Timestamp';
    public const H_NONCE = 'X-Migration-Nonce';
    public const H_SIGNATURE = 'X-Migration-Signature';

    public static function signRequest(MigrationKey $key, string $method, string $path, string $body = ''): array
    {
        $timestamp = (string) now()->getTimestamp();
        $nonce = bin2hex(random_bytes(16));

        return [
            self::H_KEY_ID => $key->id(),
            self::H_TIMESTAMP => $timestamp,
            self::H_NONCE => $nonce,
            self::H_SIGNATURE => self::requestSignature($key, $method, $path, $timestamp, $nonce, $body),
        ];
    }

    /**
     * Returns null when valid, otherwise the reason it was rejected.
     */
    public static function verifyRequest(
        MigrationKey $key,
        string $method,
        string $path,
        array $headers,
        string $body,
    ): ?string {
        $keyId = (string) ($headers[self::H_KEY_ID] ?? '');
        $timestamp = (string) ($headers[self::H_TIMESTAMP] ?? '');
        $nonce = (string) ($headers[self::H_NONCE] ?? '');
        $signature = (string) ($headers[self::H_SIGNATURE] ?? '');

        if (!hash_equals($key->id(), $keyId)) {
            return 'unknown key';
        }
        if (!ctype_digit($timestamp) || abs(now()->getTimestamp() - (int) $timestamp) > self::MAX_CLOCK_SKEW) {
            return 'request too old - check both servers\' clocks';
        }
        if (!preg_match('/^[0-9a-f]{32}$/', $nonce)) {
            return 'malformed nonce';
        }
        $expected = self::requestSignature($key, $method, $path, $timestamp, $nonce, $body);
        if (!hash_equals($expected, $signature)) {
            return 'bad signature';
        }
        // Only now record the nonce, so unauthenticated junk can't fill the cache
        if (!Cache::add("migration-nonce:{$nonce}", true, self::MAX_CLOCK_SKEW * 2)) {
            return 'replayed request';
        }

        return null;
    }

    public static function signResponse(MigrationKey $key, string $requestNonce, string $body): string
    {
        return hash_hmac('sha256', "RESPONSE\n{$requestNonce}\n" . hash('sha256', $body), $key->authKey());
    }

    public static function verifyResponse(MigrationKey $key, string $requestNonce, string $body, string $signature): bool
    {
        return hash_equals(self::signResponse($key, $requestNonce, $body), $signature);
    }

    private static function requestSignature(
        MigrationKey $key,
        string $method,
        string $path,
        string $timestamp,
        string $nonce,
        string $body,
    ): string {
        $canonical = implode("\n", [strtoupper($method), '/' . ltrim($path, '/'), $timestamp, $nonce, hash('sha256', $body)]);

        return hash_hmac('sha256', $canonical, $key->authKey());
    }
}
