<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Mailbox;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Mailbox> */
class MailboxFactory extends Factory
{
    protected $model = Mailbox::class;

    public function definition(): array
    {
        return [
            'label' => fake()->word(),
            'email' => fake()->unique()->safeEmail(),
            'provider_preset' => Mailbox::PRESET_IMAP,
            'imap_host' => 'imap.example.com',
            'imap_port' => 993,
            'imap_encryption' => 'ssl',
            'smtp_host' => 'smtp.example.com',
            'smtp_port' => 587,
            'smtp_encryption' => 'starttls',
            'username' => fake()->userName(),
            'credentials' => ['password' => 'secret-password-for-tests'],
            'sync_interval_minutes' => 5,
            'save_sent_copy' => false,
            'status' => Mailbox::STATUS_CONNECTED,
        ];
    }
}
