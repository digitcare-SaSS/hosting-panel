<?php

namespace Tests\Feature;

use App\Jobs\CreateMigrationExport;
use App\Jobs\MigrateFromServer;
use App\Models\MigrationExport;
use App\Models\Setting;
use App\Models\User;
use App\Services\Migration\MigrationClient;
use App\Services\Migration\MigrationKey;
use App\Services\Migration\MigrationSigner;
use App\Services\Migration\MigrationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MigrationTest extends TestCase
{
    use RefreshDatabase;

    private string $stateDir;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.key' => 'base64:' . base64_encode(str_repeat('k', 32))]);
        $this->stateDir = sys_get_temp_dir() . '/sada-mia-migration-test-' . bin2hex(random_bytes(4));
        mkdir($this->stateDir . '/migration', 0777, true);
        config(['hosting.backup_path' => $this->stateDir, 'hosting.restore_status_path' => $this->stateDir . '/restore']);
        // Most tests exercise an enabled panel; the switch itself is covered separately
        Setting::set('migration_enabled', '1');
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->stateDir));
        parent::tearDown();
    }

    private function admin(bool $passwordConfirmed = true): User
    {
        $user = User::factory()->create(['password' => bcrypt('admin-pass')]);
        Sanctum::actingAs($user);
        if ($passwordConfirmed) {
            Cache::put('migration-password-confirmed:' . $user->id, true, 600);
        }

        return $user;
    }

    /**
     * Send a request to this app's source endpoints signed like the new panel would.
     */
    private function signed(MigrationKey $key, string $method, string $path, string $body = '{}', array $tamper = [])
    {
        $headers = array_merge(MigrationSigner::signRequest($key, $method, $path, $body), $tamper);
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        foreach ($headers as $name => $value) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $name))] = $value;
        }

        return [$this->call($method, $path, [], [], [], $server, $method === 'GET' ? null : $body), $headers];
    }

    // ── Key ──────────────────────────────────────────────────────────────────

    public function test_generated_key_round_trips_and_its_secret_is_stored_encrypted()
    {
        $this->admin();

        $response = $this->postJson('/api/migration/key')->assertCreated();
        $string = $response->json('key');

        $this->assertStringStartsWith('SMIG1.', $string);
        $parsed = MigrationKey::parse($string);
        $this->assertSame('http://localhost', $parsed->url);
        $this->assertSame(MigrationKey::active()->secret, $parsed->secret);
        $this->assertEqualsWithDelta(now()->addHours(6)->getTimestamp(), $parsed->expiresAt, 5);

        // Only an APP_KEY-encrypted secret is stored, never the raw one
        $stored = Setting::get('migration_key_secret');
        $this->assertStringNotContainsString(base64_encode($parsed->secret), $stored);
        $this->assertSame(base64_encode($parsed->secret), Crypt::decryptString($stored));

        // The key is shown once: later the page only learns that one is active, never the key itself
        $status = $this->getJson('/api/migration')
            ->assertJsonPath('source.key_active', true)
            ->assertJsonPath('source.key_url', 'http://localhost');
        $this->assertStringNotContainsString($string, $status->getContent());
        $this->assertStringNotContainsString(substr($string, 6, 40), $status->getContent());
        $this->getJson('/api/migration/key')->assertStatus(405);

        $this->deleteJson('/api/migration/key')->assertOk();
        $this->assertNull(MigrationKey::active());
    }

    public function test_malformed_or_expired_keys_are_rejected_with_a_clear_message()
    {
        foreach (['hello', 'SMIG1.not-base64-json', 'SMIG1.' . rtrim(strtr(base64_encode('{"u":"x","s":"c2hvcnQ","e":9999999999}'), '+/', '-_'), '=')] as $bad) {
            try {
                MigrationKey::parse($bad);
                $this->fail("Accepted bad key {$bad}");
            } catch (\RuntimeException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }

        $expired = (new MigrationKey('http://old', random_bytes(32), time() - 10))->toString();
        $this->expectExceptionMessage('expired');
        MigrationKey::parse($expired);
    }

    // ── Source endpoints + signature checks ──────────────────────────────────

    public function test_signed_handshake_is_answered_with_a_signed_summary()
    {
        $key = MigrationKey::generate('http://old-panel');

        [$response, $headers] = $this->signed($key, 'POST', '/api/migration/source/handshake');

        $response->assertOk()->assertJsonStructure(['hostname', 'counts' => ['apps', 'databases', 'domains', 'email_accounts']]);
        $this->assertTrue(MigrationSigner::verifyResponse(
            $key, $headers[MigrationSigner::H_NONCE], $response->getContent(), $response->headers->get(MigrationSigner::H_SIGNATURE)
        ));
    }

    public function test_requests_without_the_right_key_are_rejected()
    {
        $key = MigrationKey::generate('http://old-panel');
        $impostor = new MigrationKey('http://old-panel', random_bytes(32), time() + 3600);

        // Wrong key
        [$r] = $this->signed($impostor, 'POST', '/api/migration/source/handshake');
        $r->assertUnauthorized();

        // Tampered body
        $headers = MigrationSigner::signRequest($key, 'POST', '/api/migration/source/handshake', '{}');
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        foreach ($headers as $n => $v) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $n))] = $v;
        }
        $this->call('POST', '/api/migration/source/handshake', [], [], [], $server, '{"x":1}')->assertUnauthorized();

        // Replay of a valid request
        [$ok, $used] = $this->signed($key, 'POST', '/api/migration/source/handshake');
        $ok->assertOk();
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        foreach ($used as $n => $v) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $n))] = $v;
        }
        $this->call('POST', '/api/migration/source/handshake', [], [], [], $server, '{}')
            ->assertUnauthorized()->assertJsonFragment(['error' => 'Migration key rejected: replayed request.']);

        // Stale timestamp
        $this->travel(10)->minutes();
        [$stale] = $this->signed($key, 'POST', '/api/migration/source/handshake', '{}', [MigrationSigner::H_TIMESTAMP => (string) (time() - 3600)]);
        $stale->assertUnauthorized();

        // No unauthenticated access at all
        $this->postJson('/api/migration/source/handshake')->assertUnauthorized();
    }

    public function test_repeated_failures_are_rate_limited()
    {
        MigrationKey::generate('http://old-panel');
        $impostor = new MigrationKey('http://old-panel', random_bytes(32), time() + 3600);

        for ($i = 0; $i < 10; $i++) {
            [$r] = $this->signed($impostor, 'POST', '/api/migration/source/handshake');
            $r->assertUnauthorized();
        }
        [$blocked] = $this->signed($impostor, 'POST', '/api/migration/source/handshake');
        $blocked->assertStatus(429);
    }

    public function test_revoked_or_expired_key_stops_all_source_access()
    {
        $key = MigrationKey::generate('http://old-panel');
        MigrationKey::revoke();
        [$r] = $this->signed($key, 'POST', '/api/migration/source/handshake');
        $r->assertUnauthorized();

        $key = MigrationKey::generate('http://old-panel');
        $this->travel(25)->hours();
        [$r] = $this->signed($key, 'POST', '/api/migration/source/handshake');
        $r->assertUnauthorized();
    }

    public function test_export_is_encrypted_with_the_key_derived_passphrase_and_reused()
    {
        Queue::fake();
        $key = MigrationKey::generate('http://old-panel');

        [$first] = $this->signed($key, 'POST', '/api/migration/source/export');
        $first->assertCreated()->assertJsonPath('status', 'pending');
        [$second] = $this->signed($key, 'POST', '/api/migration/source/export');
        $second->assertOk()->assertJsonPath('id', $first->json('id'));

        Queue::assertPushed(CreateMigrationExport::class, 1);
        Queue::assertPushed(CreateMigrationExport::class, function ($job) use ($key) {
            $encrypted = (fn () => $this->encryptedPassphrase)->call($job);
            return Crypt::decryptString($encrypted) === $key->archivePassphrase();
        });
    }

    public function test_download_streams_the_archive_and_complete_deletes_it_and_retires_the_key()
    {
        $key = MigrationKey::generate('http://old-panel');
        $file = $this->stateDir . '/sada-mia-old-1.tar.gz.enc';
        file_put_contents($file, str_repeat('x', 4096));
        MigrationExport::create(['status' => 'completed', 'filename' => basename($file), 'local_path' => $file, 'size_bytes' => 4096]);

        [$download] = $this->signed($key, 'GET', '/api/migration/source/export/download', '');
        $download->assertOk();
        $this->assertSame(4096, (int) $download->headers->get('Content-Length'));

        [$done] = $this->signed($key, 'POST', '/api/migration/source/complete');
        $done->assertOk();
        $this->assertFileDoesNotExist($file);
        $this->assertSame('transferred', MigrationExport::first()->status);
        $this->assertNull(MigrationKey::active());
    }

    public function test_new_key_is_refused_while_an_export_runs_and_discards_old_archives()
    {
        $this->admin();
        $old = $this->stateDir . '/old.tar.gz.enc';
        file_put_contents($old, 'x');
        $export = MigrationExport::create(['status' => 'running']);

        $this->postJson('/api/migration/key')->assertStatus(409);

        $export->update(['status' => 'completed', 'local_path' => $old]);
        $failed = MigrationExport::create(['status' => 'failed', 'error' => 'earlier attempt']);
        $this->postJson('/api/migration/key')->assertCreated();
        $this->assertFileDoesNotExist($old);
        $this->assertSame('expired', $export->fresh()->status);
        $this->assertSame('expired', $failed->fresh()->status);
    }

    public function test_snapshot_scrub_removes_the_key_and_export_history()
    {
        // Stand-in for the VACUUM INTO snapshot (VACUUM can't run inside the test transaction)
        $copy = $this->stateDir . '/copy.sqlite';
        $pdo = new \PDO('sqlite:' . $copy);
        $pdo->exec('CREATE TABLE settings (key TEXT, value TEXT)');
        $pdo->exec('CREATE TABLE migration_exports (id INTEGER, status TEXT)');
        $pdo->exec('CREATE TABLE migration_events (id INTEGER, event TEXT)');
        $pdo->exec("INSERT INTO migration_events VALUES (1, 'key_created')");
        $pdo->exec("INSERT INTO settings VALUES ('migration_enabled', '1')");
        $pdo->exec("INSERT INTO settings VALUES ('migration_key_secret', 'x'), ('migration_key_expires_at', '1'), ('migration_key_url', 'u'), ('migrationXkeyXother', 'keep'), ('server_ip', '1.2.3.4')");
        $pdo->exec("INSERT INTO migration_exports VALUES (1, 'running')");
        $pdo = null;

        $scrub = (new \ReflectionClass(\App\Services\Migration\MigrationExportService::class))->getMethod('scrubSnapshot');
        $scrub->invoke(app(\App\Services\Migration\MigrationExportService::class), $copy);

        $pdo = new \PDO('sqlite:' . $copy);
        $this->assertSame('0', (string) $pdo->query("SELECT COUNT(*) FROM settings WHERE key IN ('migration_key_secret', 'migration_key_expires_at', 'migration_key_url')")->fetchColumn());
        $this->assertSame('0', (string) $pdo->query('SELECT COUNT(*) FROM migration_exports')->fetchColumn());
        $this->assertSame('0', (string) $pdo->query('SELECT COUNT(*) FROM migration_events')->fetchColumn());
        // The new server starts with migration switched OFF
        $this->assertSame('0', (string) $pdo->query("SELECT COUNT(*) FROM settings WHERE key = 'migration_enabled'")->fetchColumn());
        $this->assertSame('2', (string) $pdo->query("SELECT COUNT(*) FROM settings WHERE key IN ('server_ip', 'migrationXkeyXother')")->fetchColumn());
    }

    // ── Target side ──────────────────────────────────────────────────────────

    /**
     * Route the client's outgoing HTTP calls into this same app, which plays the old panel.
     */
    private function loopback(?callable $mutate = null): void
    {
        Http::fake(function (ClientRequest $request) use ($mutate) {
            $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
            foreach ($request->headers() as $name => $values) {
                $server['HTTP_' . strtoupper(str_replace('-', '_', $name))] = $values[0];
            }
            $path = parse_url($request->url(), PHP_URL_PATH);
            $response = $this->call($request->method(), $path, [], [], [], $server, $request->method() === 'GET' ? null : $request->body());
            $body = $response->getContent();
            if ($mutate) {
                $body = $mutate($body);
            }

            return Http::response($body, $response->getStatusCode(), [
                MigrationSigner::H_SIGNATURE => (string) $response->headers->get(MigrationSigner::H_SIGNATURE),
                'Content-Type' => 'application/json',
            ]);
        });
    }

    public function test_connect_validates_the_key_against_the_old_panel()
    {
        $key = MigrationKey::generate('http://old-panel:8083');
        $this->loopback();
        $this->admin();

        $this->postJson('/api/migration/connect', ['key' => $key->toString()])
            ->assertOk()
            ->assertJsonPath('url', 'http://old-panel:8083')
            ->assertJsonStructure(['source' => ['hostname', 'counts']]);

        // Overriding the address (e.g. the old panel's public IP) is honoured
        $this->postJson('/api/migration/connect', ['key' => $key->toString(), 'url' => 'http://203.0.113.5:8083'])
            ->assertOk()->assertJsonPath('url', 'http://203.0.113.5:8083');
        Http::assertSent(fn (ClientRequest $r) => str_starts_with($r->url(), 'http://203.0.113.5:8083/api/migration/source/handshake'));
    }

    public function test_a_tampered_or_impostor_answer_is_refused()
    {
        $key = MigrationKey::generate('http://old-panel:8083');
        $this->admin();

        $this->loopback(fn ($body) => str_replace('"apps"', '"apps_"', $body));
        $this->postJson('/api/migration/connect', ['key' => $key->toString()])
            ->assertStatus(422)
            ->assertJsonFragment(['error' => 'The answer was not signed with this migration key - this is not the panel that issued it.']);
    }

    public function test_unreachable_old_panel_gives_an_actionable_error()
    {
        $key = new MigrationKey('http://old-panel:8083', random_bytes(32), time() + 3600);
        Http::fake(fn () => throw new \Illuminate\Http\Client\ConnectionException('refused'));
        $this->admin();

        $this->postJson('/api/migration/connect', ['key' => $key->toString()])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Could not reach the old panel at http://old-panel:8083. Check the address and that its panel port is open to this server.');
    }

    public function test_start_requires_typed_confirmation_and_progress_requires_the_token()
    {
        $key = MigrationKey::generate('http://old-panel:8083');
        $this->loopback();
        Queue::fake([MigrateFromServer::class]);
        $this->admin();

        $this->postJson('/api/migration/start', ['key' => $key->toString(), 'url' => $key->url, 'confirm' => 'yes'])
            ->assertUnprocessable();

        $token = $this->postJson('/api/migration/start', ['key' => $key->toString(), 'url' => $key->url, 'confirm' => 'MIGRATE'])
            ->assertStatus(202)->json('token');
        Queue::assertPushed(MigrateFromServer::class);

        // Second start while running is refused
        $this->postJson('/api/migration/start', ['key' => $key->toString(), 'url' => $key->url, 'confirm' => 'MIGRATE'])
            ->assertStatus(409);

        // Progress: public, but only with the token
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/public/migration/progress?token=wrong')->assertNotFound();
        $this->getJson('/api/public/migration/progress')->assertNotFound();
        $this->getJson("/api/public/migration/progress?token={$token}")
            ->assertOk()
            ->assertJsonPath('status', 'running')
            ->assertJsonPath('phase', 'connecting')
            ->assertJsonMissingPath('token_hash');
    }

    public function test_progress_follows_the_root_restore_status()
    {
        $state = app(MigrationState::class);
        $token = $state->begin(['url' => 'http://old', 'hostname' => 'old']);
        $state->update(['status' => 'restoring', 'phase' => 'restoring']);
        mkdir($this->stateDir . '/restore');
        file_put_contents($this->stateDir . '/restore/restore.log', "==> Restoring PostgreSQL database: app\n");
        file_put_contents($this->stateDir . '/restore/status.json', json_encode(['state' => 'running']));

        $this->getJson("/api/public/migration/progress?token={$token}")
            ->assertJsonPath('status', 'restoring')
            ->assertJsonFragment(['phase' => 'restoring']);
        $this->assertStringContainsString('Restoring PostgreSQL database: app', $this->getJson("/api/public/migration/progress?token={$token}")->json('log'));

        file_put_contents($this->stateDir . '/restore/status.json', json_encode(['state' => 'completed']));
        $this->getJson("/api/public/migration/progress?token={$token}")
            ->assertJsonPath('status', 'completed')->assertJsonPath('phase', 'done');

        file_put_contents($this->stateDir . '/restore/status.json', json_encode(['state' => 'failed', 'message' => 'boom']));
        $this->getJson("/api/public/migration/progress?token={$token}")
            ->assertJsonPath('status', 'failed')->assertJsonPath('error', 'boom');
    }

    public function test_client_refuses_an_unsigned_answer()
    {
        $key = new MigrationKey('http://old-panel:8083', random_bytes(32), time() + 3600);
        Http::fake(['*' => Http::response(['hostname' => 'evil'], 200)]);

        $this->expectExceptionMessage('not signed with this migration key');
        (new MigrationClient($key))->handshake();
    }

    // ── On/off switch, password confirmation, IP lock, audit trail ──────────

    public function test_migration_is_off_by_default_and_then_nothing_can_be_copied()
    {
        $key = MigrationKey::generate('http://old-panel');
        Setting::set('migration_enabled', null);
        $this->assertFalse(\App\Services\Migration\MigrationSwitch::isOn());

        // A perfectly valid key is useless while migration is off
        foreach ([['POST', '/handshake'], ['POST', '/export'], ['GET', '/export'], ['GET', '/export/download'], ['POST', '/complete']] as [$m, $path]) {
            [$r] = $this->signed($key, $m, "/api/migration/source{$path}", $m === 'GET' ? '' : '{}');
            $r->assertForbidden()->assertJsonPath('error', 'Migration is turned off on this panel.');
            $this->app['cache']->store()->flush(); // keep the rate limiter out of this loop
        }

        // And this panel can't generate keys, connect or receive either
        $this->admin();
        $this->postJson('/api/migration/key')->assertForbidden()->assertJsonPath('code', 'migration_off');
        $this->postJson('/api/migration/connect', ['key' => $key->toString()])->assertForbidden();
        $this->postJson('/api/migration/start', ['key' => $key->toString(), 'url' => 'http://x', 'confirm' => 'MIGRATE'])->assertForbidden();
        $this->getJson('/api/migration')->assertJsonPath('enabled', false);
    }

    public function test_turning_on_requires_the_password_and_turning_off_revokes_everything()
    {
        Setting::set('migration_enabled', null);
        $this->admin(passwordConfirmed: false);

        $this->putJson('/api/migration/enabled', ['enabled' => true])
            ->assertStatus(423)->assertJsonPath('code', 'password_confirmation_required');
        $this->postJson('/api/migration/confirm-password', ['password' => 'wrong'])->assertUnprocessable();
        $this->postJson('/api/migration/confirm-password', ['password' => 'admin-pass'])->assertOk();
        $this->putJson('/api/migration/enabled', ['enabled' => true])->assertOk()->assertJsonPath('enabled', true);

        $this->postJson('/api/migration/key')->assertCreated();
        $archive = $this->stateDir . '/ready.tar.gz.enc';
        file_put_contents($archive, 'x');
        MigrationExport::create(['status' => 'completed', 'local_path' => $archive]);

        // Turning off needs no password and closes everything at once
        Cache::flush();
        $this->putJson('/api/migration/enabled', ['enabled' => false])->assertOk()->assertJsonPath('enabled', false);
        $this->assertNull(MigrationKey::active());
        $this->assertFileDoesNotExist($archive);

        $events = \App\Models\MigrationEvent::pluck('event')->all();
        $this->assertSame(['password_failed', 'enabled', 'key_created', 'disabled'], $events);
    }

    public function test_sensitive_actions_need_a_recent_password_confirmation()
    {
        MigrationKey::generate('http://old-panel');
        $this->admin(passwordConfirmed: false);

        $this->postJson('/api/migration/key')->assertStatus(423);
        $this->postJson('/api/migration/start', ['key' => 'x', 'url' => 'http://x', 'confirm' => 'MIGRATE'])->assertStatus(423);

        $this->postJson('/api/migration/confirm-password', ['password' => 'admin-pass'])->assertOk();
        $this->postJson('/api/migration/key')->assertCreated();

        // Confirmation expires
        $this->travel(11)->minutes();
        $this->postJson('/api/migration/key')->assertStatus(423);
    }

    public function test_password_confirmation_is_rate_limited()
    {
        $this->admin(passwordConfirmed: false);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/migration/confirm-password', ['password' => 'guess' . $i])->assertUnprocessable();
        }
        $this->postJson('/api/migration/confirm-password', ['password' => 'admin-pass'])->assertStatus(429);
    }

    public function test_key_can_be_locked_to_the_new_servers_ip()
    {
        $this->admin();
        $this->postJson('/api/migration/key', ['hours' => 1, 'allowed_ip' => '203.0.113.7'])
            ->assertCreated()->assertJsonPath('allowed_ip', '203.0.113.7');
        $key = MigrationKey::active();
        $this->assertEqualsWithDelta(now()->addHour()->getTimestamp(), $key->expiresAt, 5);
        $this->postJson('/api/migration/key', ['hours' => 3])->assertUnprocessable();

        // Tests come from 127.0.0.1: refused even with the right key
        [$r] = $this->signed($key, 'POST', '/api/migration/source/handshake');
        $r->assertForbidden()->assertJsonPath(
            'error',
            'This migration key is locked to a different server IP. Your server connected from 127.0.0.1 - create a new key for that IP on the old panel.'
        );

        // From the allowed IP it works
        $headers = MigrationSigner::signRequest($key, 'POST', '/api/migration/source/handshake', '{}');
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'REMOTE_ADDR' => '203.0.113.7'];
        foreach ($headers as $n => $v) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $n))] = $v;
        }
        $this->call('POST', '/api/migration/source/handshake', [], [], [], $server, '{}')->assertOk();

        $this->assertTrue(\App\Models\MigrationEvent::where('event', 'rejected')->where('ip', '127.0.0.1')->exists());
        $this->assertTrue(\App\Models\MigrationEvent::where('event', 'connected')->where('ip', '203.0.113.7')->exists());
    }

    public function test_a_finished_transfer_switches_migration_off()
    {
        $key = MigrationKey::generate('http://old-panel');
        [$done] = $this->signed($key, 'POST', '/api/migration/source/complete');
        $done->assertOk();

        $this->assertFalse(\App\Services\Migration\MigrationSwitch::isOn());
        $this->assertNull(MigrationKey::active());
        $this->assertSame('Turned off automatically after the transfer', \App\Models\MigrationEvent::where('event', 'disabled')->value('details'));
    }

    public function test_settings_report_the_switch_but_cannot_flip_it_without_the_password_flow()
    {
        Setting::set('migration_enabled', null);
        $this->admin(passwordConfirmed: false);

        $this->getJson('/api/settings')->assertOk()->assertJsonPath('migration_enabled', false);
        Setting::set('server_ip', '198.51.100.20');
        $this->getJson('/api/migration')->assertJsonPath('server_ip', '198.51.100.20');

        // The generic settings save ignores it - only PUT /migration/enabled (with password) can turn it on
        $this->postJson('/api/settings', ['migration_enabled' => true, 'migration_key_secret' => 'x']);
        $this->assertFalse(\App\Services\Migration\MigrationSwitch::isOn());
        $this->assertNull(Setting::get('migration_key_secret'));

        Setting::set('migration_enabled', '1');
        $this->getJson('/api/settings')->assertJsonPath('migration_enabled', true);
    }
}
