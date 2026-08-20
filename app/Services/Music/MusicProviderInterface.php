<?php

namespace App\Services\Music;

interface MusicProviderInterface
{
    /**
     * Search for music tracks.
     *
     * @param  string  $query
     * @param  int  $limit
     * @param  int  $offset
     * @return array{
     *     tracks: array<array{
     *         id: string,
     *         title: string,
     *         artist: string,
     *         artist_id: string|null,
     *         duration: int,
     *         artwork_url: string|null,
     *         audio_url: string|null,
     *         genre: string|null,
     *         bpm: int|null,
     *         release_date: string|null,
     *         license: string|null,
     *         provider: string,
     *         provider_id: string,
     *         attribution: string|null,
     *         is_downloadable: bool,
     *         is_streamable: bool,
     *     }>,
     *     total: int,
     *     has_more: bool,
     * }
     */
    public function search(string $query, int $limit = 20, int $offset = 0): array;

    /**
     * Get trending/popular tracks.
     *
     * @param  int  $limit
     * @param  int  $offset
     * @return array{
     *     tracks: array<array{
     *         id: string,
     *         title: string,
     *         artist: string,
     *         artist_id: string|null,
     *         duration: int,
     *         artwork_url: string|null,
     *         audio_url: string|null,
     *         genre: string|null,
     *         bpm: int|null,
     *         release_date: string|null,
     *         license: string|null,
     *         provider: string,
     *         provider_id: string,
     *         attribution: string|null,
     *         is_downloadable: bool,
     *         is_streamable: bool,
     *     }>,
     *     total: int,
     *     has_more: bool,
     * }
     */
    public function getTrending(int $limit = 20, int $offset = 0): array;

    /**
     * Get track details by provider ID.
     *
     * @param  string  $providerId
     * @return array|null
     */
    public function getTrack(string $providerId): ?array;

    /**
     * Get licensing/usage information for a track.
     *
     * @param  string  $providerId
     * @return array{
     *     can_use_in_video: bool,
     *     can_download: bool,
     *     can_commercial: bool,
     *     requires_attribution: bool,
     *     attribution_text: string|null,
     *     license_type: string|null,
     *     restrictions: array<string>,
     * }
     */
    public function getLicensing(string $providerId): array;

    /**
     * Get the provider identifier.
     */
    public function getProviderName(): string;

    /**
     * Check if the provider is available/configured.
     */
    public function isAvailable(): bool;
}