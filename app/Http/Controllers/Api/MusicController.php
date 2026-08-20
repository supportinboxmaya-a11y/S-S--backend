<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Traits\ApiHelpers;
use App\Http\Controllers\Controller;
use App\Services\Music\MusicService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MusicController extends Controller
{
    use ApiHelpers;

    protected MusicService $musicService;

    public function __construct(MusicService $musicService)
    {
        $this->middleware('auth');
        $this->musicService = $musicService;
    }

    /**
     * Search for music tracks.
     */
    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => 'required|string|min:1|max:100',
            'limit' => 'sometimes|integer|min:1|max:50',
            'offset' => 'sometimes|integer|min:0',
        ]);

        $query = trim($validated['q']);
        $limit = $validated['limit'] ?? config('music.search_limit', 20);
        $offset = $validated['offset'] ?? 0;

        if ($query === '') {
            return $this->data($this->emptyResponse());
        }

        $result = $this->musicService->search($query, $limit, $offset);

        return $this->data([
            'tracks' => $result['tracks'],
            'meta' => [
                'total' => $result['total'],
                'has_more' => $result['has_more'],
                'limit' => $limit,
                'offset' => $offset,
            ],
        ]);
    }

    /**
     * Get trending/popular music tracks.
     */
    public function trending(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'limit' => 'sometimes|integer|min:1|max:50',
            'offset' => 'sometimes|integer|min:0',
        ]);

        $limit = $validated['limit'] ?? config('music.trending_limit', 20);
        $offset = $validated['offset'] ?? 0;

        $result = $this->musicService->getTrending($limit, $offset);

        return $this->data([
            'tracks' => $result['tracks'],
            'meta' => [
                'total' => $result['total'],
                'has_more' => $result['has_more'],
                'limit' => $limit,
                'offset' => $offset,
            ],
        ]);
    }

    /**
     * Get track details by provider ID.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $track = $this->musicService->getNormalizedTrack($id);

        if (! $track) {
            return $this->error('Track not found', 404);
        }

        return $this->data($track);
    }

    /**
     * Get licensing information for a track.
     */
    public function licensing(Request $request, string $id): JsonResponse
    {
        $track = $this->musicService->getTrack($id);

        if (! $track) {
            return $this->error('Track not found', 404);
        }

        $licensing = $this->musicService->getLicensing($id);

        return $this->data(array_merge($licensing, [
            'track_id' => $id,
            'track_title' => $track['title'] ?? '',
            'track_artist' => $track['artist'] ?? '',
        ]));
    }

    protected function emptyResponse(): array
    {
        return [
            'tracks' => [],
            'meta' => [
                'total' => 0,
                'has_more' => false,
                'limit' => 0,
                'offset' => 0,
            ],
        ];
    }
}