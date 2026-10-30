<?php

namespace App\Services\Migration;

use App\Models\Setting;
use Illuminate\Support\Facades\Crypt;
use RuntimeException;

/**
 * The migration key pairs an old (source) panel with a new (target) panel.
 *
 * Key string: "SMIG1." + base64url({"u": source panel URL, "s": base64url(32-byte secret), "e": expiry})
 *
 * The secret itself never travels over the network. Both panels derive from it:
 *  - an HMAC key that signs every request and response (authentication + integrity), and
 *  - the passphrase the migration archive is encrypted with (confidentiality, even over plain http).
 */
class MigrationKey
{
    public const PREFIX = 'SMIG1.';
    public const ALLOWED_TTL_HOURS = [1, 6, 24];

    private const SETTING_SECRET = 'migration_key_secret';
    private const SETTING_EXPIRES = 'migration_key_expires_at';
    private const SETTING_URL = 'migration_key_url';
    private const SETTING_ALLOWED_IP = 'migration_key_allowed_ip';

    public function __construct(
        public readonly string $url,
        public readonly string $secret,
        public readonly int $expiresAt,
        public readonly ?string $allowedIp = null,
    ) {}

    /**
     * Create a new key for this (source) panel, replacing any previous one.
     *
     * @param string|null $allowedIp only the new server at this IP may use the key
     */
    public static function generate(string $sourceUrl, int $hours = 6, ?string $allowedIp = null): self
    {
        $key = new self(rtrim($sourceUrl, '/'), random_bytes(32), now()->addHours($hours)->getTimestamp(), $allowedIp);

        Setting::set(self::SETTING_SECRET, Crypt::encryptString(base64_encode($key->secret)));
        Setting::set(self::SETTING_EXPIRES, (string) $key->expiresAt);
        Setting::set(self::SETTING_URL, $key->url);
        Setting::set(self::SETTING_ALLOWED_IP, $allowedIp);

        return $key;
    }

    /**
     * The key this panel issued, if it is still valid.
     */
    public static function active(): ?self
    {
        $encrypted = Setting::get(self::SETTING_SECRET);
        $expires = (int) Setting::get(self::SETTING_EXPIRES, 0);
        if (!$encrypted || $expires < now()->getTimestamp()) {
            return null;
        }

        return new self(
            (string) Setting::get(self::SETTING_URL, ''),
            base64_decode(Crypt::decryptString($encrypted)),
            $expires,
            Setting::get(self::SETTING_ALLOWED_IP) ?: null,
        );
    }

    public static function revoke(): void
    {
        Setting::set(self::SETTING_SECRET, null);
        Setting::set(self::SETTING_EXPIRES, null);
        Setting::set(self::SETTING_URL, null);
        Setting::set(self::SETTING_ALLOWED_IP, null);
    }

    /**
     * Parse a key pasted into the target panel.
     */
    public static function parse(string $value): self
    {
        $value = trim($value);
        if (!str_starts_with($value, self::PREFIX)) {
            throw new RuntimeException('This is not a migration key. Generate one on the old panel under Migration.');
        }

        $data = json_decode(self::base64UrlDecode(substr($value, strlen(self::PREFIX))), true);
        $secret = is_array($data) && is_string($data['s'] ?? null) ? self::base64UrlDecode($data['s']) : '';
        if (!is_string($data['u'] ?? null) || strlen($secret) !== 32 || !is_int($data['e'] ?? null)) {
            throw new RuntimeException('The migration key is incomplete or damaged. Copy it again from the old panel.');
        }
        if ($data['e'] < now()->getTimestamp()) {
            throw new RuntimeException('This migration key has expired. Generate a new one on the old panel.');
        }

        return new self($data['u'], $secret, $data['e']);
    }

    public function toString(): string
    {
        return self::PREFIX . self::base64UrlEncode(json_encode([
            'u' => $this->url,
            's' => self::base64UrlEncode($this->secret),
            'e' => $this->expiresAt,
        ], JSON_UNESCAPED_SLASHES));
    }

    /**
     * Public identifier of the key, so a source can tell which key a request claims to use.
     */
    public function id(): string
    {
        return substr(hash('sha256', 'sada-mia-migration-id' . $this->secret), 0, 16);
    }

    public function authKey(): string
    {
        return hash_hmac('sha256', 'sada-mia-migration-auth', $this->secret, true);
    }

    public function archivePassphrase(): string
    {
        return hash_hmac('sha256', 'sada-mia-migration-archive', $this->secret);
    }

    public function withUrl(string $url): self
    {
        return new self(rtrim($url, '/'), $this->secret, $this->expiresAt, $this->allowedIp);
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'), true);
    }
}
