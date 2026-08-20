<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Music Provider
    |--------------------------------------------------------------------------
    |
    | The music provider to use for searching and retrieving music tracks.
    | Supported: 'audius', 'soundcloud', 'custom'
    |
    */
    'provider' => env('MUSIC_PROVIDER', 'audius'),

    /*
    |--------------------------------------------------------------------------
    | Audius Configuration
    |--------------------------------------------------------------------------
    |
    | Audius is a decentralized music streaming protocol.
    | No API key required for basic usage.
    | Docs: https://docs.audius.org/
    |
    */
    'audius' => [
        'base_url' => env('AUDIUS_API_URL', 'https://api.audius.co'),
        'discovery_provider' => env('AUDIUS_DISCOVERY_PROVIDER', 'https://discoveryprovider.audius.co'),
        'timeout' => (float) env('AUDIUS_TIMEOUT', 10.0),
        'app_name' => env('AUDIUS_APP_NAME', config('app.name', 'Loops')),
    ],

    /*
    |--------------------------------------------------------------------------
    | SoundCloud Configuration
    |--------------------------------------------------------------------------
    |
    | Requires a SoundCloud API client ID.
    | Get one at https://soundcloud.com/you/apps
    |
    */
    'soundcloud' => [
        'client_id' => env('SOUNDCLOUD_CLIENT_ID'),
        'base_url' => env('SOUNDCLOUD_API_URL', 'https://api.soundcloud.com'),
        'timeout' => (float) env('SOUNDCLOUD_TIMEOUT', 10.0),
    ],

    /*
    |--------------------------------------------------------------------------
    | General Music Settings
    |--------------------------------------------------------------------------
    */
    'cache_ttl' => (int) env('MUSIC_CACHE_TTL', 3600),
    'search_limit' => (int) env('MUSIC_SEARCH_LIMIT', 20),
    'trending_limit' => (int) env('MUSIC_TRENDING_LIMIT', 20),
    'enable_licensing_check' => (bool) env('MUSIC_ENABLE_LICENSING_CHECK', true),
    'require_attribution' => (bool) env('MUSIC_REQUIRE_ATTRIBUTION', true),
];