<?php

declare(strict_types=1);

/**
 * AI chat: optional access to folders on THIS machine. Off by default and only honoured when the app runs on a
 * non-production environment and the request comes from the loopback address. The client picks a root by id; it never sends an absolute path.
 */
return [
    'local_workspace' => [
        'enabled' => (bool) env('AI_CHAT_LOCAL_ENABLED', false),

        // * Where a folder imported from the UI may live: comma-separated absolute folders. Empty = the home folder of the user running PHP. The base itself is never importable.
        'import_bases' => array_values(array_filter(array_map('trim', explode(',', (string) env('AI_CHAT_LOCAL_IMPORT_BASES', ''))))),

        // * "id=/absolute/folder,other=/another/folder". Ids: letters, digits, `_` and `-`.
        'roots' => (function (): array {
            $roots = [];

            foreach (explode(',', (string) env('AI_CHAT_LOCAL_ROOTS', '')) as $pair) {
                [$id, $path] = array_pad(explode('=', trim($pair), 2), 2, '');

                if (preg_match('/^[a-z0-9_-]{1,40}$/', $id) === 1 && $path !== '') {
                    $roots[$id] = $path;
                }
            }

            return $roots;
        })(),
    ],
];
