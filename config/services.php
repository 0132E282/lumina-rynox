<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google_analytics' => [
        'credentials_path' => env('GOOGLE_ANALYTICS_CREDENTIALS_PATH'),
        'property_id' => env('GOOGLE_ANALYTICS_PROPERTY_ID'),
    ],

    // * LinkedIn personal sign-in (OAuth 2.0 authorization code). Endpoints/scopes are unverified against current LinkedIn docs.
    'linkedin' => [
        'client_id' => env('LINKEDIN_CLIENT_ID'),
        'client_secret' => env('LINKEDIN_CLIENT_SECRET'),
        // * Blank = the named route `integrations.linkedin.oauth.callback`; must equal a redirect URI registered in the LinkedIn app.
        'redirect' => env('LINKEDIN_REDIRECT_URI'),
        'authorize_url' => 'https://www.linkedin.com/oauth/v2/authorization',
        'token_url' => 'https://www.linkedin.com/oauth/v2/accessToken',
        'userinfo_url' => 'https://api.linkedin.com/v2/userinfo',
        'scopes' => ['openid', 'profile', 'w_member_social'],
        'timeout_seconds' => 8,
        'connect_timeout_seconds' => 4,
    ],

    // * Zalo bridge sidecar (`zalo-bridge/`): loopback HTTP signed with HMAC-SHA256 in both directions.
    'zalo_bridge' => [
        'url' => env('ZALO_BRIDGE_URL', 'http://127.0.0.1:3790'),
        'secret' => env('ZALO_BRIDGE_SECRET'),
        'send_per_minute' => (int) env('ZALO_BRIDGE_SEND_PER_MINUTE', 10),
    ],

    // * Extra folders (colon separated) searched for `claude`, `codex` and `gemini` when the web process's PATH does not contain them
    // * (a server started from an app or a service has a short PATH). The usual install folders are always tried after these.
    'ai_cli' => [
        'paths' => env('AI_CLI_PATH', ''),
    ],

    // * Converts a browser voice recording (WebM/Opus) to AAC before it goes to Messenger; without the binary the recording is sent as it is.
    'ffmpeg' => [
        'binary' => env('FFMPEG_PATH', 'ffmpeg'),
    ],

    // * Matrix Client-Server API of the homeserver Laravel signs in to (see docs/repo/messenger-mautrix-runbook.md). The user runs this homeserver themselves; it is never installed or started by this app.
    'matrix' => [
        'homeserver_url' => env('MATRIX_HOMESERVER_URL'),
        'user_id' => env('MATRIX_USER_ID'),
        'access_token' => env('MATRIX_ACCESS_TOKEN'),
    ],

    // * mautrix-meta bridge (bridgev2) Provisioning API, reached over loopback with a shared secret. The bridge process is run by the user, never by this app.
    'mautrix_meta' => [
        'provisioning_url' => env('MAUTRIX_META_PROVISIONING_URL'),
        'provisioning_secret' => env('MAUTRIX_META_PROVISIONING_SECRET'),
        'bot_user_id' => env('MAUTRIX_META_BOT_USER_ID'),
        'ghost_prefix' => env('MAUTRIX_META_GHOST_PREFIX', '@meta_'),
        'send_per_minute' => (int) env('MAUTRIX_META_SEND_PER_MINUTE', 10),
    ],

    // * ElevenLabs text-to-speech and voice cloning for the AI chat's spoken answers. Without a key the chat keeps using the device's own voice.
    'elevenlabs' => [
        'key' => env('ELEVENLABS_API_KEY'),
        'model' => env('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
    ],

];
