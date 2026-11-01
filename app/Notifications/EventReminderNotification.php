<?php

declare(strict_types=1);

namespace App\Notifications;

use App\Models\Event;
use Carbon\CarbonImmutable;
use Illuminate\Notifications\Notification;

/** * In-app (database) reminder for one event occurrence; no mail or other channel. */
class EventReminderNotification extends Notification
{
    public function __construct(
        private readonly Event $event,
        private readonly CarbonImmutable $startsAt,
        private readonly int $minutes,
    ) {}

    /** @return array<int, string> */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /** @return array<string, mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'title' => "Sắp tới: {$this->event->title}",
            'description' => "{$this->startsAt->format('H:i d/m/Y')} ({$this->lead()})",
            'icon' => 'calendar',
            'event_id' => $this->event->id,
            'url' => "/events/{$this->event->id}",
        ];
    }

    private function lead(): string
    {
        return $this->minutes >= 1440
            ? 'nhắc trước '.intdiv($this->minutes, 1440).' ngày'
            : "nhắc trước {$this->minutes} phút";
    }
}
