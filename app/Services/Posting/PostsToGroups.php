<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Group branch of the personal-account publishers: one target = one saved group, posted through the script's `group_url` input.
 * It shares the publisher's own hourly limit (same RateLimiter key), its result mapping and the `unknown`-is-never-retried rule.
 * The group composer's selectors are UNVERIFIED (see the group block in scripts/{facebook,linkedin}-post.mjs).
 */
trait PostsToGroups
{
    /**
     * @param  array<string, mixed>  $input
     * @return array{status: 'ok'|'error'|'timed_out'|'no_node'|'no_result', payload: array<string, mixed>}
     */
    abstract private function runGroupScript(array $input): array;

    abstract private function groupRateKey(): string;

    abstract private function groupHourlyLimit(): int;

    /** @return non-empty-string regular expression a saved group URL must match */
    abstract private function groupUrlPattern(): string;

    abstract private function counted(PublishResult $result): PublishResult;

    /** @param array<string, mixed> $payload */
    abstract private function published(array $payload): PublishResult;

    abstract private function failure(string $code): PublishResult;

    /**
     * @param  list<string>  $images
     *
     * @throws PublishAborted
     */
    protected function sendToGroup(Post $post, array $images): PublishResult
    {
        $group = $this->target?->group;

        if ($group === null || $group->provider !== $this->integrationKey() || preg_match($this->groupUrlPattern(), $group->url) !== 1) {
            throw PublishAborted::failed('Nhóm đã lưu không còn hợp lệ, hãy đồng bộ lại danh sách nhóm. Bài chưa được đăng.');
        }

        if (RateLimiter::tooManyAttempts($this->groupRateKey(), $this->groupHourlyLimit())) {
            throw PublishAborted::failedHaltingBatch('Đã đạt giới hạn số bài mỗi giờ của '.$this->platformName().', đã dừng đợt đăng nhóm. Bài chưa được đăng.');
        }

        // * A group post is seen by the group's members; the script only needs a valid value, so the platform's default is sent.
        $input = [
            'text' => $post->body,
            'audience' => array_key_first((array) config('posting.providers.'.$this->integrationKey().'.audiences')),
            'group_url' => $group->url,
        ];

        if ($images !== []) {
            $input['images'] = $images;
        }

        $outcome = $this->runGroupScript($input);

        return $this->counted(match ($outcome['status']) {
            'ok' => $this->published($outcome['payload']),
            'no_node' => PublishResult::failed('Không chạy được Node trên máy này, bài chưa được đăng.'),
            'error' => $this->failure((string) ($outcome['payload']['error'] ?? 'unknown')),
            default => PublishResult::unknown(self::UNCONFIRMED),
        });
    }
}
