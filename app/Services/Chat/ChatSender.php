<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Http\UploadedFile;

/** * Sends staff replies on one channel. One attempt per call: a timeout leaves the message `unknown`, only a manual `resend()` tries again. */
interface ChatSender
{
    /** @throws ChatUnavailableException */
    public function ensureCanSend(Conversation $conversation): Integration;

    /**
     * A repeated `$clientToken` returns the stored message untouched, so a double submit cannot send twice.
     *
     * @throws ChatUnavailableException
     */
    public function send(Conversation $conversation, string $body, string $clientToken, ?string $staffName): ChatMessage;

    /**
     * One file (image or document) with an optional caption; same single-attempt and `$clientToken` rules as `send()`.
     *
     * @throws ChatUnavailableException when the channel cannot send files
     */
    public function sendAttachment(Conversation $conversation, UploadedFile $file, string $caption, string $clientToken, ?string $staffName): ChatMessage;

    /**
     * Manual retry of an `unknown` or `failed` message; `null` when another attempt already claimed it.
     *
     * @throws ChatUnavailableException
     */
    public function resend(ChatMessage $message): ?ChatMessage;
}
