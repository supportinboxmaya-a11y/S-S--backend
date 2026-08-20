<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Traits\ApiHelpers;
use App\Http\Controllers\Controller;
use App\Http\Resources\VideoCompactResource;
use App\Http\Resources\VideoSoundResource;
use App\Models\Video;
use App\Models\VideoSound;
use App\Services\Music\MusicService;
use App\Support\CursorToken;
use Illuminate\Http\Request;

class VideoSoundController extends Controller
{
    use ApiHelpers;

    public function __construct(protected MusicService $musicService)
    {
        $this->middleware('auth');
    }

    public function getSoundDetails(Request $request, $id)
    {
        // Check if it's a provider sound ID (non-numeric or prefixed)
        if (! ctype_digit((string) $id)) {
            return $this->getProviderSoundDetails($request, $id);
        }

        $sound = VideoSound::active()->findOrFail($id);

        return $this->data(new VideoSoundResource($sound));
    }

    public function getProviderSoundDetails(Request $request, string $providerId)
    {
        $track = $this->musicService->getNormalizedTrack($providerId);

        if (! $track) {
            return $this->error('Track not found', 404);
        }

        return $this->data($track);
    }

    public function getSoundFeed(Request $request, $id)
    {
        // Check if it's a provider sound ID (non-numeric)
        if (! ctype_digit((string) $id)) {
            return $this->getProviderSoundFeed($request, $id);
        }

        $validated = $request->validate([
            'key' => 'required|string|min:32|max:32',
            'cursor' => 'sometimes',
        ]);

        $user = $request->user();
        $limit = 10;

        $key = $request->input('key');
        $preCursor = $validated['cursor'] ?? null;

        $sound = VideoSound::active()->findOrFail($id);
        $soundKey = substr($sound->fingerprint_hash, 0, 32);

        if (! hash_equals($soundKey, $key)) {
            return $this->error('Invalid sound entity');
        }

        $ctx = hash('sha256', implode('|', [
            $user->id,
            'explore-sounds',
            'sound:'.$sound->id,
            'limit:'.$limit,
            'order:id_desc',
        ]));

        $decodedCursor = null;
        $hops = 0;

        $maxPages = $user->is_admin ? 300 : 20;
        $maxItems = $user->is_admin ? 10000 : 400;

        if ($request->filled('cursor')) {
            [
                'cursor' => $decodedCursor,
                'hops' => $hops
            ] = CursorToken::decode($preCursor, $ctx);

            if ($hops >= $maxPages) {
                return $this->defaultTagResponse($request, $limit);
            }

            if (($hops * $limit) >= $maxItems) {
                return $this->defaultTagResponse($request, $limit);
            }
        }

        $pager = Video::published()
            ->where('sound_id', $sound->id)
            ->orderByDesc('id')
            ->cursorPaginate(
                perPage: $limit,
                columns: ['*'],
                cursorName: 'cursor',
                cursor: $decodedCursor
            );

        $nextLaravelCursor = $pager->nextCursor()?->encode();
        $nextCursorToken = CursorToken::encode($nextLaravelCursor, $ctx, $hops + 1);

        $tags = $pager->getCollection();

        return VideoCompactResource::collection($tags)->additional([
            'links' => [
                'first' => null,
                'last' => null,
                'prev' => null,
                'next' => null,
            ],
            'meta' => [
                'path' => $request->url(),
                'per_page' => $limit,
                'next_cursor' => $nextCursorToken,
                'prev_cursor' => $preCursor,
            ],
        ]);
    }

    public function getProviderSoundFeed(Request $request, string $providerId)
    {
        $validated = $request->validate([
            'cursor' => 'sometimes|string',
        ]);

        $user = $request->user();
        $limit = 10;
        $preCursor = $validated['cursor'] ?? null;

        $track = $this->musicService->getTrack($providerId);

        if (! $track) {
            return $this->error('Track not found', 404);
        }

        $ctx = hash('sha256', implode('|', [
            $user->id,
            'explore-sounds',
            'provider_sound:'.$providerId,
            'limit:'.$limit,
            'order:id_desc',
        ]));

        $decodedCursor = null;
        $hops = 0;

        $maxPages = $user->is_admin ? 300 : 20;
        $maxItems = $user->is_admin ? 10000 : 400;

        if ($request->filled('cursor')) {
            [
                'cursor' => $decodedCursor,
                'hops' => $hops
            ] = CursorToken::decode($preCursor, $ctx);

            if ($hops >= $maxPages) {
                return $this->defaultTagResponse($request, $limit);
            }

            if (($hops * $limit) >= $maxItems) {
                return $this->defaultTagResponse($request, $limit);
            }
        }

        $pager = Video::published()
            ->where('provider_track_id', $providerId)
            ->where('music_provider', $this->musicService->getProviderName())
            ->orderByDesc('id')
            ->cursorPaginate(
                perPage: $limit,
                columns: ['*'],
                cursorName: 'cursor',
                cursor: $decodedCursor
            );

        $nextLaravelCursor = $pager->nextCursor()?->encode();
        $nextCursorToken = CursorToken::encode($nextLaravelCursor, $ctx, $hops + 1);

        $tags = $pager->getCollection();

        return VideoCompactResource::collection($tags)->additional([
            'links' => [
                'first' => null,
                'last' => null,
                'prev' => null,
                'next' => null,
            ],
            'meta' => [
                'path' => $request->url(),
                'per_page' => $limit,
                'next_cursor' => $nextCursorToken,
                'prev_cursor' => $preCursor,
            ],
        ]);
    }

    public function defaultTagResponse($request, $limit)
    {
        return response()->json([
            'data' => [],
            'links' => [
                'first' => null,
                'last' => null,
                'prev' => null,
                'next' => null,
            ],
            'meta' => [
                'path' => $request->url(),
                'per_page' => $limit,
                'next_cursor' => null,
                'prev_cursor' => null,
            ],
        ]);
    }
}
