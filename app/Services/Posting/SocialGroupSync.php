<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\SocialGroup;
use InvalidArgumentException;

/**
 * Reads the groups the personal account joined (Facebook: HTTP replay of the saved web session; LinkedIn: scripts/linkedin-post.mjs `groups`, read-only) and
 * upserts them. Groups missing from a run are only marked `left_at` (never deleted), and an empty run marks none: a partial or empty page must never wipe the saved list.
 */
final class SocialGroupSync
{
    public const PROVIDERS = ['facebook_personal', 'linkedin_personal'];

    private const FAILURES = [
        'not_logged_in' => 'Chưa đăng nhập trên máy này, hãy chạy lệnh login của nền tảng đó trước.',
        'checkpoint' => 'Nền tảng yêu cầu xác minh, hãy xử lý trong cửa sổ Chrome rồi thử lại.',
        'browser_unavailable' => 'Không mở được Chrome trên máy này (chưa cài Chrome hoặc hồ sơ đang mở ở cửa sổ khác).',
        'no_session' => 'Chưa có phiên Facebook hợp lệ, hãy chạy "Kiểm tra kết nối" hoặc lệnh login Facebook một lần.',
        'expired' => 'Phiên Facebook đã hết hạn hoặc bị từ chối, hãy chạy lại "Kiểm tra kết nối" hoặc lệnh login Facebook.',
        'timeout' => 'Hết thời gian chờ khi đọc danh sách nhóm.',
    ];

    public function __construct(
        private readonly LinkedInBrowserScript $linkedin = new LinkedInBrowserScript,
        private readonly FacebookGroupsHttp $facebookHttp = new FacebookGroupsHttp,
    ) {}

    /** @return array{synced: int, total: int} */
    public function sync(string $provider): array
    {
        $outcome = match ($provider) {
            'facebook_personal' => $this->facebookOutcome(),
            'linkedin_personal' => $this->linkedin->run('groups'),
            default => throw new InvalidArgumentException('Unknown provider.'),
        };

        if ($outcome['status'] === 'no_node') {
            throw new SocialGroupException('Không chạy được Node trên máy này.');
        }
        if ($outcome['status'] !== 'ok') {
            $code = (string) ($outcome['payload']['error'] ?? '');

            throw new SocialGroupException(self::FAILURES[$code] ?? 'Không đọc được danh sách nhóm, hãy thử lại sau.');
        }

        $now = now();
        $synced = 0;
        $seen = [];

        foreach ((array) ($outcome['payload']['groups'] ?? []) as $group) {
            $row = $this->clean($group);

            if ($row === null) {
                continue;
            }

            SocialGroup::query()->updateOrCreate(
                ['provider' => $provider, 'external_id' => $row['id']],
                // * A run that found no picture keeps the one saved before.
                ['name' => $row['name'], 'url' => $row['url'], 'synced_at' => $now, 'left_at' => null, ...($row['image'] === null ? [] : ['image_url' => $row['image']])],
            );
            $seen[] = $row['id'];
            $synced++;
        }

        // * Groups this run no longer found are marked as left, never deleted (posts point at them). An empty run marks nothing: it is more likely a page that did not load.
        if ($seen !== []) {
            SocialGroup::query()->where('provider', $provider)->whereNull('left_at')->whereNotIn('external_id', $seen)->update(['left_at' => $now]);
        }

        return ['synced' => $synced, 'total' => SocialGroup::query()->where('provider', $provider)->count()];
    }

    /** @return array{status: string, payload: array<string, mixed>} Facebook is read over HTTP with the saved session; Chrome is only for login/refresh */
    private function facebookOutcome(): array
    {
        $result = $this->facebookHttp->fetch();

        return $result['status'] === 'ok'
            ? ['status' => 'ok', 'payload' => ['groups' => $result['groups']]]
            : ['status' => 'failed', 'payload' => ['error' => $result['error']]];
    }

    /** @return array{id: string, name: string, url: string, image: string|null}|null only values of the expected shape and host leave the script's output */
    private function clean(mixed $group): ?array
    {
        if (! is_array($group)) {
            return null;
        }

        $id = $group['id'] ?? null;
        $name = $group['name'] ?? null;
        $url = $group['url'] ?? null;
        $image = $group['image'] ?? null;

        if (! is_string($id) || preg_match('/^[A-Za-z0-9.]{3,100}$/', $id) !== 1
            || ! is_string($name) || trim($name) === ''
            || ! is_string($url) || preg_match('#^https://www\.(facebook|linkedin)\.com/groups/#', $url) !== 1) {
            return null;
        }

        // * A picture only counts when it is an https link on the platform's own CDN; anything else is dropped, never stored.
        $image = is_string($image) && strlen($image) <= 2048 && preg_match('#^https://[a-z0-9.-]+\.(fbcdn\.net|facebook\.com|licdn\.com)/#i', $image) === 1 ? $image : null;

        return ['id' => $id, 'name' => mb_substr(trim($name), 0, 150), 'url' => $url, 'image' => $image];
    }
}
