<?php

declare(strict_types=1);

namespace App\Notifications;

use App\Notifications\Concerns\RendersTemplate;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class AdminLoggedInNotification extends Notification
{
    use Queueable, RendersTemplate;

    public function __construct(private readonly ?string $ip) {}

    public function via(object $notifiable): array
    {
        return ['database', 'mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $template = config('notification.templates.admin_logged_in');
        $values = ['name' => $notifiable->name, 'ip' => $this->ip ?? 'không xác định'];

        return (new MailMessage)
            ->subject($template['subject'])
            ->greeting($this->render($template['greeting'], $values))
            ->line($this->render($template['line'], $values))
            ->line($template['warning']);
    }

    public function toArray(object $notifiable): array
    {
        return [
            'title' => config('notification.templates.admin_logged_in.subject'),
            'description' => $this->ip ? "Đăng nhập từ IP {$this->ip}." : 'Bạn vừa đăng nhập vào hệ thống.',
            'icon' => 'log-in',
        ];
    }
}
