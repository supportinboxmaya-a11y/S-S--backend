<?php

namespace App\Services\Music\Providers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AudiusProvider extends BaseMusicProvider
{
    protected string $discoveryProvider;

    public function __construct()
    {
        parent::__construct();
        $this->discoveryProvider = config('music.audius.discovery_provider', 'https://discoveryprovider.audius.co');
        $this->baseUrl = $this->discoveryProvider;
    }

    protected function getConfigKey(): string
    {
        return 'audius';
    }

    protected function getProviderName(): string
    {
        return 'audius';
    }

    public function isAvailable(): bool
    {
        return ! empty($this->discoveryProvider);
    }

    public function search(string $query, int $limit = 20, int $offset = 0): array
    {
        if (! $this->isAvailable()) {
            return $this->emptyResponse();
        }

        $cacheKey = $this->cacheKey('search', ['query' => $query, 'limit' => $limit, 'offset' => $offset]);

        return $this->getCached($cacheKey, function () use ($query, $limit, $offset) {
            try {
                $response = $this->http()
                    ->get("{$this->discoveryProvider}/v1/tracks/search", [
                        'query' => $query,
                        'limit' => min($limit, 100),
                        'offset' => $offset,
                        'app_name' => config('music.audius.app_name', 'Loops'),
                    ]);

                if (! $response->successful()) {
                    Log::warning('Audius search failed', [
                        'status' => $response->status(),
                        'body' => $response->body(),
                    ]);
                    return $this->emptyResponse();
                }

                $data = $response->json();
                $tracks = collect($data['data'] ?? [])
                    ->map(fn ($track) => $this->mapTrack($track))
                    ->filter()
                    ->values()
                    ->all();

                return [
                    'tracks' => $tracks,
                    'total' => (int) ($data['total'] ?? count($tracks)),
                    'has_more' => count($tracks) >= $limit,
                ];
            } catch (\Throwable $e) {
                $this->handleError($e, 'search');
                return $this->emptyResponse();
            }
        });
    }

    public function getTrending(int $limit = 20, int $offset = 0): array
    {
        if (! $this->isAvailable()) {
            return $this->emptyResponse();
        }

        $cacheKey = $this->cacheKey('trending', ['limit' => $limit, 'offset' => $offset]);

        return $this->getCached($cacheKey, function () use ($limit, $offset) {
            try {
                $response = $this->http()
                    ->get("{$this->discoveryProvider}/v1/tracks/trending", [
                        'limit' => min($limit, 100),
                        'offset' => $offset,
                        'app_name' => config('music.audius.app_name', 'Loops'),
                        'time' => 'week',
                    ]);

                if (! $response->successful()) {
                    Log::warning('Audius trending failed', [
                        'status' => $response->status(),
                        'body' => $response->body(),
                    ]);
                    return $this->emptyResponse();
                }

                $data = $response->json();
                $tracks = collect($data['data'] ?? [])
                    ->map(fn ($track) => $this->mapTrack($track))
                    ->filter()
                    ->values()
                    ->all();

                return [
                    'tracks' => $tracks,
                    'total' => (int) ($data['total'] ?? count($tracks)),
                    'has_more' => count($tracks) >= $limit,
                ];
            } catch (\Throwable $e) {
                $this->handleError($e, 'trending');
                return $this->emptyResponse();
            }
        });
    }

    public function getTrack(string $providerId): ?array
    {
        if (! $this->isAvailable()) {
            return null;
        }

        $cacheKey = $this->cacheKey('track', ['id' => $providerId]);

        return $this->getCached($cacheKey, function () use ($providerId) {
            try {
                $response = $this->http()
                    ->get("{$this->discoveryProvider}/v1/tracks/{$providerId}", [
                        'app_name' => config('music.audius.app_name', 'Loops'),
                    ]);

                if (! $response->successful()) {
                    return null;
                }

                $data = $response->json();
                $track = $data['data'] ?? null;

                return $track ? $this->mapTrack($track) : null;
            } catch (\Throwable $e) {
                $this->handleError($e, 'getTrack');
                return null;
            }
        });
    }

    public function getLicensing(string $providerId): array
    {
        $track = $this->getTrack($providerId);

        if (! $track) {
            return $this->defaultLicensing();
        }

        $isDownloadable = (bool) ($track['downloadable'] ?? false);
        $license = $track['license'] ?? '';

        return $this->normalizeLicensing([
            'can_use_in_video' => true,
            'can_download' => $isDownloadable,
            'can_commercial' => str_contains(strtolower($license), 'creative commons') || str_contains(strtolower($license), 'cc0'),
            'requires_attribution' => ! $isDownloadable || config('music.require_attribution', true),
            'attribution_text' => $track['attribution'] ?? ($track['artist'] ? "{$track['title']} by {$track['artist']} on Audius" : null),
            'license_type' => $license ?: 'Audius Terms of Service',
            'restrictions' => $isDownloadable ? [] : ['no_download', 'streaming_only'],
        ]);
    }

    protected function mapTrack(array $track): ?array
    {
        if (empty($track['track_id']) && empty($track['id'])) {
            return null;
        }

        $id = $track['track_id'] ?? $track['id'] ?? null;
        $title = $track['title'] ?? '';
        $artist = $track['user'] ?? [];
        $artistName = $artist['name'] ?? $artist['handle'] ?? '';
        $artistId = $artist['user_id'] ?? null;
        $duration = (int) ($track['duration'] ?? 0);
        $artwork = $track['artwork'] ?? $track['artwork_150x150'] ?? $track['artwork_480x480'] ?? $track['artwork_1000x1000'] ?? null;
        $genre = $track['genre'] ?? null;
        $bpm = isset($track['bpm']) ? (int) $track['bpm'] : null;
        $releaseDate = $track['release_date'] ?? $track['created_at'] ?? null;
        $license = $track['license'] ?? '';
        $downloadable = (bool) ($track['downloadable'] ?? false);
        $streamUrl = $track['stream_url'] ?? $track['audio_url'] ?? null;

        if (empty($title) || empty($id)) {
            return null;
        }

        return [
            'id' => (string) $id,
            'title' => $title,
            'artist' => $artistName,
            'artist_id' => $artistId ? (string) $artistId : null,
            'duration' => $duration,
            'artwork_url' => $artwork,
            'audio_url' => $streamUrl,
            'genre' => $genre,
            'bpm' => $bpm,
            'release_date' => $releaseDate,
            'license' => $license,
            'provider' => $this->getProviderName(),
            'provider_id' => (string) $id,
            'attribution' => $artistName ? "{$title} by {$artistName} on Audius" : null,
            'is_downloadable' => $downloadable,
            'is_streamable' => ! empty($streamUrl),
            'downloadable' => $downloadable,
        ];
    }

    protected function emptyResponse(): array
    {
        return [
            'tracks' => [],
            'total' => 0,
            'has_more' => false,
        ];
    }

    protected function defaultLicensing(): array
    {
        return $this->normalizeLicensing([
            'can_use_in_video' => false,
            'can_download' => false,
            'can_commercial' => false,
            'requires_attribution' => true,
            'attribution_text' => null,
            'license_type' => 'Unknown',
            'restrictions' => ['track_not_found'],
        ]);
    }
}