<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\PostTarget;
use Illuminate\Support\Str;

/**
 * The user's own Facebook web session as scripts/facebook-post.mjs saves it (`session` and `post` modes, from the real logged-in
 * Chrome): cookie header, page tokens and the composer request template. Laravel renders the template and posts it with plain Http.
 * ! The file is 0600 and gitignored. Its content, cookies and response bodies never go into messages or logs.
 */
final class FacebookWebSession
{
    public const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

    private const REQUIRED = ['user_id', 'fb_dtsg', 'lsd', 'jazoest', 'cookie_header'];

    private const PRIVACY = [
        PostTarget::AUDIENCE_SELF => 'SELF',
        PostTarget::AUDIENCE_FRIENDS => 'FRIENDS',
        PostTarget::AUDIENCE_PUBLIC => 'EVERYONE',
    ];

    private const POST_ID_KEYS = ['post_id', 'legacy_story_hideable_id'];

    public static function path(): string
    {
        return (string) config('posting.facebook_personal.session_file');
    }

    /**
     * @return array{user_id: string, fb_dtsg: string, lsd: string, jazoest: string, cookie_header: string, template: array{params: array<string, string>, variables: array<string, mixed>}}|null
     *                                                                                                                                                                                            null when the file, any token or a complete template is missing: the HTTP tier cannot be used
     */
    public function load(): ?array
    {
        $path = self::path();

        if (! is_file($path)) {
            return null;
        }

        $data = json_decode((string) file_get_contents($path), true);

        if (! is_array($data)) {
            return null;
        }

        $session = [];

        foreach (self::REQUIRED as $key) {
            $value = $data[$key] ?? null;

            if (! is_string($value) || trim($value) === '') {
                return null;
            }

            $session[$key] = trim($value);
        }

        $template = $data['template'] ?? null;

        if (! $this->validTemplate($template)) {
            return null;
        }

        $session['template'] = $template;

        return $session;
    }

    /**
     * Tokens plus the joined-groups pagination template (saved by the `groups` and `session` script modes); the composer template is not needed.
     *
     * @return array{user_id: string, fb_dtsg: string, lsd: string, jazoest: string, cookie_header: string, groups_template: array{params: array<string, string>, variables: array<string, mixed>}}|null
     */
    public function loadGroups(): ?array
    {
        $path = self::path();
        $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;

        if (! is_array($data)) {
            return null;
        }

        $session = [];

        foreach (self::REQUIRED as $key) {
            $value = $data[$key] ?? null;

            if (! is_string($value) || trim($value) === '') {
                return null;
            }

            $session[$key] = trim($value);
        }

        $template = $data['groups_template'] ?? null;

        if (! $this->validShape($template)) {
            return null;
        }

        $session['groups_template'] = $template;

        return $session;
    }

    /**
     * Same substitution as renderTemplate in the script: placeholders become the text, the audience, the user id and fresh UUIDs;
     * the tokens come from the saved session. Unknown audience falls back to SELF.
     *
     * @param  array<string, mixed>  $session  a value of load()
     * @return array<string, string> the form body
     */
    public function render(array $session, string $text, string $audience): array
    {
        $privacy = self::PRIVACY[$audience] ?? self::PRIVACY[PostTarget::AUDIENCE_SELF];
        $uuids = [];

        $variables = $this->mapStrings($session['template']['variables'], function (string $value) use ($text, $privacy, $session, &$uuids): string {
            if ($value === '{{text}}') {
                return $text;
            }

            if ($value === '{{privacy}}') {
                return $privacy;
            }

            if ($value === '{{user}}') {
                return $session['user_id'];
            }

            if (preg_match('/^\{\{uuid:(\d+)\}\}$/', $value, $match) === 1) {
                return $uuids[$match[1]] ??= (string) Str::uuid();
            }

            return $value;
        });

        return [
            ...$session['template']['params'],
            'av' => $session['user_id'],
            '__user' => $session['user_id'],
            'fb_dtsg' => $session['fb_dtsg'],
            'lsd' => $session['lsd'],
            'jazoest' => $session['jazoest'],
            'variables' => json_encode($variables, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
        ];
    }

    /**
     * 'ok' (post id found), 'rejected' (provably not posted: 4xx, or only `errors` without `data`) or 'unknown' (may have posted).
     *
     * @return array{kind: 'ok'|'rejected'|'unknown', post_id?: string}
     */
    public function classify(int $status, string $body): array
    {
        if ($status >= 500) {
            return ['kind' => 'unknown'];
        }

        if ($status !== 200) {
            return ['kind' => 'rejected'];
        }

        $items = [];

        foreach (preg_split('/\R/', (string) preg_replace('/^\s*for \(;;\);/', '', $body)) ?: [] as $line) {
            $item = json_decode(trim($line), true);

            if (is_array($item) && ! array_is_list($item)) {
                $items[] = $item;
            }
        }

        if ($items === []) {
            return ['kind' => 'unknown'];
        }

        foreach ($items as $item) {
            if (($id = $this->findPostId($item)) !== null) {
                return ['kind' => 'ok', 'post_id' => $id];
            }
        }

        foreach ($items as $item) {
            if (is_array($item['data'] ?? null) && ! array_is_list($item['data'])) {
                return ['kind' => 'unknown'];
            }
        }

        foreach ($items as $item) {
            if (! empty($item['errors'])) {
                return ['kind' => 'rejected'];
            }
        }

        return ['kind' => 'unknown'];
    }

    private function validTemplate(mixed $template): bool
    {
        if (! $this->validShape($template)) {
            return false;
        }

        $serialized = json_encode($template['variables']);

        return is_string($serialized) && str_contains($serialized, '"{{text}}"') && str_contains($serialized, '"{{privacy}}"');
    }

    private function validShape(mixed $template): bool
    {
        if (! is_array($template) || ! is_array($template['params'] ?? null) || ! is_array($template['variables'] ?? null)) {
            return false;
        }

        foreach ($template['params'] as $key => $value) {
            if (! is_string($key) || ! is_string($value)) {
                return false;
            }
        }

        return preg_match('/^\d{5,30}$/', (string) ($template['params']['doc_id'] ?? '')) === 1;
    }

    private function mapStrings(mixed $value, callable $transform): mixed
    {
        if (is_string($value)) {
            return $transform($value);
        }

        if (is_array($value)) {
            return array_map(fn (mixed $item): mixed => $this->mapStrings($item, $transform), $value);
        }

        return $value;
    }

    private function findPostId(mixed $value): ?string
    {
        if (! is_array($value)) {
            return null;
        }

        foreach ($value as $key => $item) {
            if (in_array($key, self::POST_ID_KEYS, true) && is_string($item) && preg_match('/^[A-Za-z0-9_=-]{1,100}$/', $item) === 1) {
                return $item;
            }

            if (($found = $this->findPostId($item)) !== null) {
                return $found;
            }
        }

        return null;
    }
}
