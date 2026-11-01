<?php

declare(strict_types=1);

namespace App\Notifications;

use App\Notifications\Concerns\RendersTemplate;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class AdminAccountCreatedNotification extends Notification
{
    use Queueable, RendersTemplate;

    public function via(object $notifiable): array
    {
        return ['database', 'mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $template = config('notification.templates.admin_account_created');
        $values = ['name' => $notifiable->name, 'email' => $notifiable->email];

        return (new MailMessage)
            ->subject($template['subject'])
            ->greeting($this->render($template['greeting'], $values))
            ->line($this->render($template['line'], $values))
            ->line("Email đăng nhập: {$notifiable->email}")
            ->action($template['action'], url('/login'));
    }

    public function toArray(object $notifiable): array
    {
        return [
            'title' => config('notification.templates.admin_account_created.subject'),
            'description' => 'Tài khoản quản trị viên của bạn đã được tạo trong hệ thống.',
            'icon' => 'user-plus',
        ];
    }
}
