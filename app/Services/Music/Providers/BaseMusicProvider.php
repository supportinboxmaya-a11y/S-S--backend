<?php

namespace App\Services\Music\Providers;

use App\Services\Music\MusicProviderInterface;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

abstract class BaseMusicProvider implements MusicProviderInterface
{
    protected string $baseUrl;
    protected float $timeout;
    protected int $cacheTtl;

    public function __construct()
    {
        $this->baseUrl = config("music.{$this->getConfigKey()}.base_url", '');
        $this->timeout = config("music.{$this->getConfigKey()}.timeout", 10.0);
        $this->cacheTtl = config('music.cache_ttl', 3600);
    }

    abstract protected function getConfigKey(): string;

    abstract protected function getProviderName(): string;

    protected function http(): \Illuminate\Http\Client\PendingRequest
    {
        return Http::timeout($this->timeout)
            ->acceptJson()
            ->retry(2, 100);
    }

    protected function cacheKey(string $method, array $params = []): string
    {
        $key = 'music:'.$this->getProviderName().':'.$method;
        if (! empty($params)) {
            $key .= ':'.md5(json_encode($params));
        }
        return $key;
    }

    protected function getCached(string $key, callable $callback, ?int $ttl = null)
    {
        return Cache::remember($key, $ttl ?? $this->cacheTtl, $callback);
    }

    protected function handleError(\Throwable $e, string $context): void
    {
        Log::error("Music provider {$this->getProviderName()} error: {$context}", [
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString(),
        ]);
    }

    protected function normalizeTrack(array $track): array
    {
        return [
            'id' => $track['id'] ?? null,
            'title' => $track['title'] ?? '',
            'artist' => $track['artist'] ?? '',
            'artist_id' => $track['artist_id'] ?? null,
            'duration' => (int) ($track['duration'] ?? 0),
            'artwork_url' => $track['artwork_url'] ?? null,
            'audio_url' => $track['audio_url'] ?? null,
            'genre' => $track['genre'] ?? null,
            'bpm' => isset($track['bpm']) ? (int) $track['bpm'] : null,
            'release_date' => $track['release_date'] ?? null,
            'license' => $track['license'] ?? null,
            'provider' => $this->getProviderName(),
            'provider_id' => $track['provider_id'] ?? $track['id'] ?? null,
            'attribution' => $track['attribution'] ?? null,
            'is_downloadable' => (bool) ($track['is_downloadable'] ?? false),
            'is_streamable' => (bool) ($track['is_streamable'] ?? true),
        ];
    }

    protected function normalizeLicensing(array $licensing): array
    {
        return [
            'can_use_in_video' => (bool) ($licensing['can_use_in_video'] ?? true),
            'can_download' => (bool) ($licensing['can_download'] ?? false),
            'can_commercial' => (bool) ($licensing['can_commercial'] ?? false),
            'requires_attribution' => (bool) ($licensing['requires_attribution'] ?? config('music.require_attribution', true)),
            'attribution_text' => $licensing['attribution_text'] ?? null,
            'license_type' => $licensing['license_type'] ?? null,
            'restrictions' => $licensing['restrictions'] ?? [],
        ];
    }
}