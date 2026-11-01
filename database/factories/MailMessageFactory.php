<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Mailbox;
use App\Models\MailFolder;
use App\Models\MailMessage;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<MailMessage> */
class MailMessageFactory extends Factory
{
    protected $model = MailMessage::class;

    public function definition(): array
    {
        $messageId = Str::uuid()->toString().'@example.test';

        return [
            'mailbox_id' => Mailbox::factory(),
            'mail_folder_id' => fn (array $attributes) => MailFolder::query()->create([
                'mailbox_id' => $attributes['mailbox_id'],
                'role' => MailFolder::ROLE_INBOX,
                'name' => 'INBOX',
            ])->id,
            'uid' => fake()->unique()->numberBetween(1, 1_000_000),
            'message_id' => $messageId,
            'thread_key' => sha1($messageId),
            'from_name' => fake()->name(),
            'from_email' => fake()->safeEmail(),
            'to' => [['name' => null, 'email' => fake()->safeEmail()]],
            'subject' => fake()->sentence(),
            'snippet' => fake()->sentence(),
            'received_at' => now(),
            'seen' => false,
            'size' => 1024,
        ];
    }
}
