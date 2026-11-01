<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use App\Models\PostTarget;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Sleep;
use Illuminate\Support\Str;
use Throwable;

/**
 * Sends posts to their platforms, one attempt per target. Every state change that decides "who sends" is a single atomic UPDATE
 * (`... WHERE status IN (from)`), so two workers, a double click or an overlapping scheduler run cannot send the same target twice.
 * There is no automatic retry: only `claimTarget()` from a manual action may re-enter a `failed`/`unknown` target.
 */
final class PostPublishingService
{
    private const ERROR_LENGTH = 500;

    private const BATCH_STOPPED = 'Đã dừng cả đợt đăng nhóm (nền tảng yêu cầu xác minh, chưa đăng nhập hoặc đã đạt giới hạn mỗi giờ). Bài chưa được đăng, hãy xử lý rồi bấm Thử lại.';

    public function __construct(private readonly PostProviders $providers) {}

    /**
     * * Claims a scheduled/missed post and publishes every pending target. Returns false when someone else got it first.
     *
     * @param  list<string>  $from
     */
    public function publishPost(Post $post, array $from = [Post::STATUS_SCHEDULED, Post::STATUS_MISSED]): bool
    {
        $claimed = Post::query()
            ->whereKey($post->id)
            ->whereIn('status', $from)
            ->update(['status' => Post::STATUS_PUBLISHING, 'updated_at' => now()]);

        if ($claimed === 0) {
            return false;
        }

        $post->status = Post::STATUS_PUBLISHING;
        $post->syncOriginal();

        $targets = PostTarget::query()->where('post_id', $post->id)->where('status', PostTarget::STATUS_PENDING)->orderBy('id')->get();

        // * Group targets of one provider run strictly one after another with a random pause between them; a result that halts the batch
        // * (checkpoint, not logged in, hourly cap) fails the provider's remaining group targets without touching the site again.
        $halted = [];
        $groupRuns = [];
        $skipped = false;

        foreach ($targets as $target) {
            $isGroup = $target->social_group_id !== null;

            if ($isGroup && isset($halted[$target->provider])) {
                $skipped = $this->failUnsent($target) || $skipped;

                continue;
            }

            // * The pause protects against posting bursts, so it is only needed after a group post that may have gone out; a failed one sent nothing.
            if ($isGroup && ($groupRuns[$target->provider] ?? false)) {
                $this->pauseBetweenGroups();
            }

            if ($this->claimTarget($target, [PostTarget::STATUS_PENDING])) {
                $result = $this->publishClaimedTarget($target);

                if ($isGroup) {
                    $groupRuns[$target->provider] = $result->status !== PostTarget::STATUS_FAILED;
                }

                if ($result->haltsBatch) {
                    $halted[$target->provider] = true;
                }
            }
        }

        if ($skipped) {
            $post->refreshStatus();
        }

        // * A post without any target has nothing to wait for; it goes back to draft instead of hanging in `publishing`.
        if ($targets->isEmpty() && $post->refreshStatus() === null) {
            Post::query()->whereKey($post->id)->where('status', Post::STATUS_PUBLISHING)->update(['status' => Post::STATUS_DRAFT, 'scheduled_at' => null]);
        }

        return true;
    }

    /**
     * * Atomically moves a target to `publishing` and counts the attempt; false means it was not in `$from` (already taken).
     *
     * @param  list<string>  $from
     */
    public function claimTarget(PostTarget $target, array $from): bool
    {
        $claimed = PostTarget::query()
            ->whereKey($target->id)
            ->whereIn('status', $from)
            ->update([
                'status' => PostTarget::STATUS_PUBLISHING,
                'error' => null,
                'attempts' => DB::raw('attempts + 1'),
                'updated_at' => now(),
            ]);

        if ($claimed === 0) {
            return false;
        }

        $target->refresh();

        return true;
    }

    /** * Sends a target that `claimTarget()` returned true for, stores the outcome and refreshes the post status. */
    public function publishClaimedTarget(PostTarget $target): PublishResult
    {
        try {
            $result = $this->providers->publisher($target->provider)->publish($target->loadMissing('post'));
        } catch (Throwable $exception) {
            // ! A publisher bug may have fired after the request went out, so the safe reading is "unknown", never "failed".
            report($exception);
            $result = PublishResult::unknown('Lỗi không xác định khi đăng, bài có thể đã được đăng.');
        }

        // * "Dừng đăng" may have failed this target while the script ran: a plain failure then keeps the stop; a result that may be live is always stored.
        $stopped = ! PostTarget::query()->whereKey($target->id)->where('status', PostTarget::STATUS_PUBLISHING)->exists();

        if ($stopped && $result->status === PostTarget::STATUS_FAILED) {
            $target->refresh()->post->refreshStatus();

            return $result;
        }

        $target->forceFill([
            'status' => $result->status,
            'external_post_id' => $result->externalId,
            'external_url' => $result->externalUrl,
            'error' => $result->error === null ? null : Str::limit($result->error, self::ERROR_LENGTH),
            'published_at' => $result->status === PostTarget::STATUS_PUBLISHED ? now() : null,
        ])->save();

        $target->post->refreshStatus();

        return $result;
    }

    private function pauseBetweenGroups(): void
    {
        $minimum = max(0, (int) config('posting.group_posting.delay_min_seconds'));
        $maximum = max($minimum, (int) config('posting.group_posting.delay_max_seconds'));

        Sleep::for(random_int($minimum, $maximum))->seconds();
    }

    /** * Atomic like `claimTarget()`: only a still-pending target is failed, and it is not counted as an attempt (nothing was sent). */
    private function failUnsent(PostTarget $target): bool
    {
        return PostTarget::query()
            ->whereKey($target->id)
            ->where('status', PostTarget::STATUS_PENDING)
            ->update(['status' => PostTarget::STATUS_FAILED, 'error' => self::BATCH_STOPPED, 'updated_at' => now()]) > 0;
    }

    /**
     * * Recovers work whose worker died: a `publishing` target idle for too long becomes `unknown` (it may have been sent, so no
     * * retry), and a `publishing` post idle for too long is settled or, if it still has unsent targets, put back to `scheduled`.
     */
    public function recoverStale(): int
    {
        $cutoff = now()->subMinutes((int) config('posting.stale_publishing_minutes'));

        $targets = PostTarget::query()
            ->where('status', PostTarget::STATUS_PUBLISHING)
            ->where('updated_at', '<', $cutoff)
            ->update(['status' => PostTarget::STATUS_UNKNOWN, 'error' => 'Không nhận được phản hồi, bài có thể đã được đăng.', 'updated_at' => now()]);

        $recovered = $targets;

        Post::query()->where('status', Post::STATUS_PUBLISHING)->where('updated_at', '<', $cutoff)->chunkById(50, function ($posts) use (&$recovered): void {
            foreach ($posts as $post) {
                if ($post->refreshStatus() !== null) {
                    $recovered++;

                    continue;
                }

                // * Still has pending targets (never attempted): safe to hand back to the scheduler.
                $recovered += Post::query()->whereKey($post->id)->where('status', Post::STATUS_PUBLISHING)->update(['status' => Post::STATUS_SCHEDULED, 'updated_at' => now()]);
            }
        });

        return $recovered;
    }
}
