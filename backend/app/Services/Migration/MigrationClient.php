<?php

namespace App\Services\Migration;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Target side: talks to the old panel. Every request is signed with the migration key
 * and every JSON response must carry a valid signature from the same key.
 */
class MigrationClient
{
    private const SOURCE_PREFIX = '/api/migration/source';

    public function __construct(private MigrationKey $key) {}

    public function handshake(): array
    {
        return $this->call('POST', '/handshake');
    }

    public function startExport(): array
    {
        return $this->call('POST', '/export');
    }

    public function exportStatus(): array
    {
        return $this->call('GET', '/export');
    }

    public function complete(): array
    {
        return $this->call('POST', '/complete');
    }

    /**
     * Download the archive into $path, resuming from whatever is already there.
     *
     * @param callable(int $done, int $total): void $onProgress
     */
    public function download(string $path, int $expectedSize, callable $onProgress): void
    {
        $route = self::SOURCE_PREFIX . '/export/download';
        $attempts = 0;

        while (true) {
            clearstatcache(true, $path);
            $have = is_file($path) ? filesize($path) : 0;
            if ($have >= $expectedSize) {
                return;
            }

            $handle = fopen($path, 'ab');
            $headers = MigrationSigner::signRequest($this->key, 'GET', $route);
            if ($have > 0) {
                $headers['Range'] = "bytes={$have}-";
            }

            try {
                $lastReport = 0;
                $response = Http::withHeaders($headers)
                    ->timeout(0)
                    ->connectTimeout(15)
                    ->withOptions([
                        'sink' => $handle,
                        'progress' => function ($total, $downloaded) use ($have, $expectedSize, $onProgress, &$lastReport) {
                            if (microtime(true) - $lastReport >= 1) {
                                $lastReport = microtime(true);
                                $onProgress($have + $downloaded, $expectedSize);
                            }
                        },
                    ])
                    ->get($this->url($route));

                if (!in_array($response->status(), [200, 206], true)) {
                    // The error body went into the sink as well - cut the file back to the good bytes
                    is_resource($handle) && fclose($handle);
                    $truncate = fopen($path, 'r+');
                    ftruncate($truncate, $have);
                    fclose($truncate);
                    throw new RuntimeException("The old panel refused the download (HTTP {$response->status()}).");
                }
                if ($have > 0 && $response->status() === 200) {
                    // Server ignored the Range header and sent everything again - start over
                    is_resource($handle) && fclose($handle);
                    file_put_contents($path, '');
                    continue;
                }
            } catch (ConnectionException $e) {
                if (++$attempts >= 5) {
                    throw new RuntimeException('The connection to the old panel kept dropping during the transfer: ' . $e->getMessage());
                }
                sleep(5);
            } finally {
                is_resource($handle) && fclose($handle);
            }

            clearstatcache(true, $path);
            $onProgress(filesize($path), $expectedSize);
        }
    }

    private function call(string $method, string $path): array
    {
        $route = self::SOURCE_PREFIX . $path;
        $body = $method === 'GET' ? '' : '{}';
        $headers = MigrationSigner::signRequest($this->key, $method, $route, $body);

        try {
            $request = Http::withHeaders($headers)->acceptJson()->timeout(60)->connectTimeout(15);
            $response = $method === 'GET'
                ? $request->get($this->url($route))
                : $request->withBody($body, 'application/json')->send($method, $this->url($route));
        } catch (ConnectionException $e) {
            throw new RuntimeException("Could not reach the old panel at {$this->key->url}. Check the address and that its panel port is open to this server.");
        }

        if ($response->status() === 404 && !$response->json('error')) {
            throw new RuntimeException("{$this->key->url} does not look like a Sada Mia panel with migration support (update the old panel first).");
        }
        if (!$response->successful()) {
            throw new RuntimeException('The old panel answered: ' . $this->errorMessage($response));
        }

        $signature = (string) $response->header(MigrationSigner::H_SIGNATURE);
        if (!MigrationSigner::verifyResponse($this->key, $headers[MigrationSigner::H_NONCE], $response->body(), $signature)) {
            throw new RuntimeException('The answer was not signed with this migration key - this is not the panel that issued it.');
        }

        return $response->json() ?? [];
    }

    private function url(string $route): string
    {
        return rtrim($this->key->url, '/') . $route;
    }

    private function errorMessage(Response $response): string
    {
        return $response->json('error') ?? "HTTP {$response->status()}";
    }
}
