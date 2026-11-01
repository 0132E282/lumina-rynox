<?php

declare(strict_types=1);

namespace App\Services\Ai;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Post;
use App\Models\PostTarget;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * * Every number of the report is computed here with constant queries; the AI only words the summary from them.
 * * A "day" is `[start, end]` in `cms.personal_timezone` (see `PersonalClock`), converted to UTC for the queries.
 */
class ReportBuilder
{
    /**
     * @return array{date: string, messages: array<string, array{in: int, out: int}>, unread_conversations: int, posts: array{published: int, scheduled: int, failed: int}}
     */
    public function forDay(CarbonImmutable $day): array
    {
        $start = $day->startOfDay()->utc();
        $end = $day->endOfDay()->utc();
        $sentAt = 'coalesce(chat_messages.sent_at, chat_messages.created_at)';

        $messages = [];

        ChatMessage::query()
            ->join('conversations', 'conversations.id', '=', 'chat_messages.conversation_id')
            ->whereRaw("{$sentAt} between ? and ?", [$start, $end])
            ->groupBy('conversations.provider', 'chat_messages.direction')
            ->select('conversations.provider', 'chat_messages.direction', DB::raw('count(*) as total'))
            ->get()
            ->each(function (ChatMessage $row) use (&$messages): void {
                $messages[$row->getAttribute('provider')][$row->direction] = (int) $row->getAttribute('total');
            });

        ksort($messages);

        return [
            'date' => $day->format('Y-m-d'),
            'messages' => array_map(fn (array $counts): array => ['in' => $counts[ChatMessage::DIRECTION_IN] ?? 0, 'out' => $counts[ChatMessage::DIRECTION_OUT] ?? 0], $messages),
            'unread_conversations' => Conversation::query()->where('unread_count', '>', 0)->count(),
            'posts' => [
                'published' => PostTarget::query()->where('status', PostTarget::STATUS_PUBLISHED)->whereBetween('published_at', [$start, $end])->distinct()->count('post_id'),
                'scheduled' => Post::query()->where('status', Post::STATUS_SCHEDULED)->whereBetween('scheduled_at', [$start, $end])->count(),
                'failed' => Post::query()->where('status', Post::STATUS_FAILED)->whereBetween('updated_at', [$start, $end])->count(),
            ],
        ];
    }

    /** @param array{date: string, messages: array<string, array{in: int, out: int}>, unread_conversations: int, posts: array{published: int, scheduled: int, failed: int}} $report */
    public function format(array $report): string
    {
        $lines = ['Báo cáo ngày '.CarbonImmutable::parse($report['date'])->format('d/m/Y').':'];

        if ($report['messages'] === []) {
            $lines[] = '- Tin nhắn: không có.';
        }

        foreach ($report['messages'] as $provider => $counts) {
            $lines[] = "- Tin nhắn {$provider}: {$counts['in']} vào, {$counts['out']} ra.";
        }

        $lines[] = "- Hội thoại chưa đọc: {$report['unread_conversations']}.";
        $lines[] = "- Bài viết: {$report['posts']['published']} đã đăng, {$report['posts']['scheduled']} lên lịch trong ngày, {$report['posts']['failed']} lỗi.";

        return implode("\n", $lines);
    }
}
