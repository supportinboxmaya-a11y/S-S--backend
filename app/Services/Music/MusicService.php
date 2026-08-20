<?php

namespace App\Services\Music;

use App\Services\Music\Providers\AudiusProvider;
use App\Services\Music\Providers\BaseMusicProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class MusicService
{
    protected MusicProviderInterface $provider;
    protected array $providers = [];
    protected string $defaultProvider;

    public function __construct()
    {
        $this->defaultProvider = config('music.provider', 'audius');
        $this->registerProviders();
        $this->setProvider($this->defaultProvider);
    }

    protected function registerProviders(): void
    {
        $this->providers = [
            'audius' => new AudiusProvider(),
        ];
    }

    public function setProvider(string $name): bool
    {
        if (! isset($this->providers[$name])) {
            Log::warning("Music provider '{$name}' not registered");
            return false;
        }

        $provider = $this->providers[$name];

        if (! $provider->isAvailable()) {
            Log::warning("Music provider '{$name}' is not available (missing config)");
            return false;
        }

        $this->provider = $provider;
        return true;
    }

    public function getProvider(): MusicProviderInterface
    {
        return $this->provider;
    }

    public function getProviderName(): string
    {
        return $this->provider->getProviderName();
    }

    public function getAvailableProviders(): array
    {
        return array_keys(array_filter($this->providers, fn ($p) => $p->isAvailable()));
    }

    public function search(string $query, int $limit = 20, int $offset = 0): array
    {
        $query = trim($query);
        if ($query === '') {
            return $this->emptyResponse();
        }

        $limit = min(max($limit, 1), 50);
        $offset = max($offset, 0);

        return $this->provider->search($query, $limit, $offset);
    }

    public function getTrending(int $limit = 20, int $offset = 0): array
    {
        $limit = min(max($limit, 1), 50);
        $offset = max($offset, 0);

        return $this->provider->getTrending($limit, $offset);
    }

    public function getTrack(string $providerId): ?array
    {
        return $this->provider->getTrack($providerId);
    }

    public function getLicensing(string $providerId): array
    {
        return $this->provider->getLicensing($providerId);
    }

    public function getNormalizedTrack(string $providerId): ?array
    {
        $track = $this->getTrack($providerId);

        if (! $track) {
            return null;
        }

        $licensing = $this->getLicensing($providerId);

        return array_merge($track, [
            'licensing' => $licensing,
        ]);
    }

    protected function emptyResponse(): array
    {
        return [
            'tracks' => [],
            'total' => 0,
            'has_more' => false,
        ];
    }

    public function clearCache(): void
    {
        Cache::flush();
    }
}