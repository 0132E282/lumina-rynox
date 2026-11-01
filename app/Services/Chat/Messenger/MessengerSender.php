<?php

declare(strict_types=1);

namespace App\Services\Chat\Messenger;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\ChatSender;
use App\Services\Chat\Matrix\BridgeProvisioningClient;
use App\Services\Chat\Matrix\MatrixClient;
use App\Services\Chat\Matrix\MatrixException;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Sends staff replies through the app's own Matrix user into a Messenger portal room. One attempt per call: a
 * timeout or 5xx leaves the message `unknown` (it may have been delivered), and only an explicit manual `resend()`
 * tries again. There is no automatic retry anywhere.
 */
final class MessengerSender implements ChatSender
{
    private const RATE_LIMIT_KEY = 'messenger-send';

    private const RATE_WINDOW_SECONDS = 60;

    private const PREVIEW_LENGTH = 120;

    private const ERROR_LENGTH = 500;

    private const BRIDGE_RECONNECTING = 'Messenger bridge chưa đăng nhập hoặc đang kết nối lại, thử lại sau.';

    public function __construct(
        private readonly MessengerChannel $channel,
        private readonly MatrixClient $matrix,
        private readonly BridgeProvisioningClient $bridge,
    ) {}

    /** @throws ChatUnavailableException */
    public function ensureCanSend(Conversation $conversation): Integration
    {
        $integration = $this->channel->connected() ?? throw new ChatUnavailableException('Messenger đang mất kết nối, chưa thể gửi tin.');

        if (! $this->channel->configured()) {
            throw new ChatUnavailableException(MessengerChannel::NOT_CONFIGURED);
        }

        if ($conversation->type === Conversation::TYPE_GROUP) {
            throw new ChatUnavailableException('Chưa hỗ trợ trả lời trong nhóm Messenger.');
        }

        $account = $conversation->messengerAccount ?? throw new ChatUnavailableException('Hội thoại này chưa gắn với tài khoản Messenger nào, chưa thể gửi tin.');

        if ($account->status !== Integration::STATUS_CONNECTED) {
            throw new ChatUnavailableException('Tài khoản Messenger'.($account->name !== null ? " \"{$account->name}\"" : '').' đang mất kết nối, chưa thể gửi tin.');
        }

        if (! $account->allows('reply')) {
            throw new ChatUnavailableException('Quyền "Trả lời tin nhắn" của tài khoản Messenger này đang tắt.');
        }

        if (! $account->allows('proactive') && ! $this->hasIncomingMessage($conversation)) {
            throw new ChatUnavailableException('Chưa có tin đến từ hội thoại này; gửi chủ động đang tắt.');
        }

        $limit = (int) config('services.mautrix_meta.send_per_minute', 10);

        $rateKey = $this->rateKey($account);

        if (RateLimiter::tooManyAttempts($rateKey, $limit)) {
            $seconds = RateLimiter::availableIn($rateKey);

            throw new ChatUnavailableException("Đang giới hạn tốc độ gửi để bảo vệ tài khoản. Thử lại sau {$seconds} giây.");
        }

        $this->ensureLoginConnected($account);

        return $integration;
    }

    public function send(Conversation $conversation, string $body, string $clientToken, ?string $staffName): ChatMessage
    {
        $this->ensureCanSend($conversation);

        $message = DB::transaction(function () use ($conversation, $body, $clientToken, $staffName): ChatMessage {
            $message = ChatMessage::query()->createOrFirst(
                ['conversation_id' => $conversation->id, 'client_token' => $clientToken],
                [
                    'direction' => ChatMessage::DIRECTION_OUT,
                    'sender_type' => ChatMessage::SENDER_STAFF,
                    'sender_name' => $staffName,
                    'body' => $body,
                    'send_status' => ChatMessage::STATUS_SENDING,
                    'sent_at' => now(),
                ],
            );

            if ($message->wasRecentlyCreated) {
                $conversation->forceFill([
                    'last_message_preview' => Str::limit(preg_replace('/\s+/u', ' ', $body) ?? $body, self::PREVIEW_LENGTH),
                    'last_message_direction' => ChatMessage::DIRECTION_OUT,
                    'last_message_at' => $message->sent_at,
                ])->save();
            }

            return $message;
        });

        return $message->wasRecentlyCreated ? $this->deliver($message, $conversation) : $message;
    }

    public function sendAttachment(Conversation $conversation, UploadedFile $file, string $caption, string $clientToken, ?string $staffName): ChatMessage
    {
        $this->ensureCanSend($conversation);

        $existing = ChatMessage::query()->where('conversation_id', $conversation->id)->where('client_token', $clientToken)->first();

        if ($existing !== null) {
            return $existing;
        }

        // * Stored under a server-generated name (`chat/{conversation}/{uuid}.{ext}`); the client's file name is kept only as a display label.
        $mime = $this->mimeOf($file);
        $isImage = str_starts_with($mime, 'image/');
        $size = $isImage ? @getimagesize($file->getRealPath()) : false;
        $path = $file->storeAs('chat/'.$conversation->id, Str::uuid()->toString().'.'.strtolower($file->guessExtension() ?? $file->getClientOriginalExtension()), ChatMessage::ATTACHMENT_DISK);
        $label = $caption !== '' ? $caption : '📎 '.$this->displayName($file);

        $message = DB::transaction(function () use ($conversation, $file, $caption, $clientToken, $staffName, $mime, $size, $path, $label): ChatMessage {
            $message = ChatMessage::query()->createOrFirst(
                ['conversation_id' => $conversation->id, 'client_token' => $clientToken],
                [
                    'direction' => ChatMessage::DIRECTION_OUT,
                    'sender_type' => ChatMessage::SENDER_STAFF,
                    'sender_name' => $staffName,
                    'body' => $caption,
                    'attachment_path' => $path,
                    'attachment_mime' => $mime,
                    'attachment_size' => (int) $file->getSize(),
                    'attachment_width' => $size === false ? null : $size[0],
                    'attachment_height' => $size === false ? null : $size[1],
                    'attachment_name' => $this->displayName($file),
                    'send_status' => ChatMessage::STATUS_SENDING,
                    'sent_at' => now(),
                ],
            );

            if ($message->wasRecentlyCreated) {
                $conversation->forceFill([
                    'last_message_preview' => Str::limit(preg_replace('/\s+/u', ' ', $label) ?? $label, self::PREVIEW_LENGTH),
                    'last_message_direction' => ChatMessage::DIRECTION_OUT,
                    'last_message_at' => $message->sent_at,
                ])->save();
            }

            return $message;
        });

        return $message->wasRecentlyCreated ? $this->deliver($message, $conversation) : $message;
    }

    private function displayName(UploadedFile $file): string
    {
        return Str::limit(preg_replace('/[\x00-\x1F\x7F\/\\\\]+/u', '', $file->getClientOriginalName()) ?: 'tệp', 200, '');
    }

    /**
     * * The status flip is one atomic UPDATE, so a second click while the first attempt runs claims nothing and returns null.
     */
    public function resend(ChatMessage $message): ?ChatMessage
    {
        $conversation = $message->conversation;
        $this->ensureCanSend($conversation);

        $claimed = ChatMessage::query()
            ->whereKey($message->id)
            ->where('direction', ChatMessage::DIRECTION_OUT)
            ->whereIn('send_status', [ChatMessage::STATUS_UNKNOWN, ChatMessage::STATUS_FAILED])
            ->update(['send_status' => ChatMessage::STATUS_SENDING, 'error' => null, 'updated_at' => now()]);

        if ($claimed === 0) {
            return null;
        }

        $message->refresh();

        return $this->deliver($message, $conversation);
    }

    private function rateKey(MessengerAccount $account): string
    {
        return self::RATE_LIMIT_KEY.':'.$account->id;
    }

    private function hasIncomingMessage(Conversation $conversation): bool
    {
        return ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->where('direction', ChatMessage::DIRECTION_IN)
            ->exists();
    }

    /** @throws ChatUnavailableException */
    private function ensureLoginConnected(MessengerAccount $account): void
    {

        try {
            $logins = $this->bridge->logins();
        } catch (ConnectionException|MatrixException) {
            throw new ChatUnavailableException(MessengerChannel::BRIDGE_DOWN);
        }

        $state = collect($logins)->firstWhere('id', $account->login_id)['state'] ?? null;

        if ($state !== 'CONNECTED') {
            throw new ChatUnavailableException(self::BRIDGE_RECONNECTING);
        }
    }

    /**
     * First attempt: `pm-{client_token}` (or its base64url form when the token has unsafe characters). A resend of a
     * message the bridge already reported as failed uses a new, deterministic id instead: reusing the old one would
     * make the homeserver replay the same (already-failed) event rather than sending it again.
     */
    private function txnId(ChatMessage $message): string
    {
        $token = preg_match('/^[A-Za-z0-9._~-]+$/', $message->client_token) === 1
            ? $message->client_token
            : rtrim(strtr(base64_encode($message->client_token), '+/', '-_'), '=');

        $suffix = $message->external_message_id !== null ? '-'.substr(sha1($message->external_message_id), 0, 8) : '';

        return "pm-{$token}{$suffix}";
    }

    private function deliver(ChatMessage $message, Conversation $conversation): ChatMessage
    {
        // * Counted per account when the bridge path is actually used, whatever the outcome.
        RateLimiter::hit($this->rateKey($conversation->messengerAccount ?? throw new ChatUnavailableException('Hội thoại này chưa gắn với tài khoản Messenger nào.')), self::RATE_WINDOW_SECONDS);

        try {
            $eventId = $message->attachment_path !== null
                ? $this->sendStoredFile($message, $conversation)
                : $this->matrix->sendText($conversation->external_chat_id, $this->txnId($message), $message->body);
        } catch (ConnectionException) {
            return $this->settle($message, ChatMessage::STATUS_UNKNOWN, 'Hết thời gian chờ, tin có thể đã được gửi.');
        } catch (MatrixException $exception) {
            if ($exception->isAmbiguous()) {
                return $this->settle($message, ChatMessage::STATUS_UNKNOWN, 'Hết thời gian chờ, tin có thể đã được gửi.');
            }

            if ($exception->isAuthFailure()) {
                $integration = $this->channel->integration();

                if ($integration !== null) {
                    $this->channel->markTokenInvalid($integration);
                }

                return $this->settle($message, ChatMessage::STATUS_FAILED, MessengerChannel::TOKEN_INVALID);
            }

            return $this->settle($message, ChatMessage::STATUS_FAILED, 'Messenger từ chối tin nhắn này, tin chưa được gửi.');
        }

        $message->forceFill([
            'send_status' => ChatMessage::STATUS_SENT,
            'error' => null,
            'external_message_id' => $eventId,
            'sent_at' => now(),
        ])->save();

        return $message;
    }

    /**
     * Uploads the stored copy and sends it; a caption follows as its own text message (Matrix has no caption on files). The returned id is the file event's.
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    private function sendStoredFile(ChatMessage $message, Conversation $conversation): string
    {
        $disk = Storage::disk(ChatMessage::ATTACHMENT_DISK);
        $path = (string) $message->attachment_path;

        if (! $disk->exists($path)) {
            throw new MatrixException(404);
        }

        $name = $message->attachment_name ?? 'tep';
        $mime = (string) $message->attachment_mime;
        $data = (string) $disk->get($path);
        $size = (int) $message->attachment_size;

        // * A browser recording (WebM/Opus) goes to Messenger as AAC; if the converter is missing the original is sent.
        if (in_array($mime, MatrixClient::AUDIO_MIMES, true) && $mime !== 'audio/mp4' && ($aac = $this->toAac($data)) !== null) {
            $data = $aac;
            $mime = 'audio/mp4';
            $size = strlen($aac);
            $name = preg_replace('/\.[A-Za-z0-9]+$/', '', $name).'.m4a';
        }

        // * Messenger shows a WebP image as a broken "!" bubble, so it goes out as JPEG; the stored original is untouched.
        if ($mime === 'image/webp' && ($jpeg = $this->webpToJpeg($data)) !== null) {
            $data = $jpeg;
            $mime = 'image/jpeg';
            $size = strlen($jpeg);
            $name = preg_replace('/\.webp$/i', '', $name).'.jpg';
        }

        $mxc = $this->matrix->uploadMedia($data, $mime, $name);
        $eventId = $this->matrix->sendFile($conversation->external_chat_id, $this->txnId($message), $mxc, $name, [
            'mime' => $mime,
            'size' => $size,
            'width' => $message->attachment_width,
            'height' => $message->attachment_height,
        ]);

        if ($message->body !== '') {
            $this->matrix->sendText($conversation->external_chat_id, $this->txnId($message).'-caption', $message->body);
        }

        return $eventId;
    }

    /** * Voice recordings are named `voice-*` by the composer; their container is reported as video/* by some detectors, so the type follows the extension. */
    private function mimeOf(UploadedFile $file): string
    {
        $mime = (string) $file->getMimeType();

        if (! str_starts_with($file->getClientOriginalName(), 'voice-')) {
            return $mime;
        }

        return match (strtolower($file->getClientOriginalExtension())) {
            'webm', 'weba' => 'audio/webm',
            'ogg', 'oga' => 'audio/ogg',
            'm4a', 'mp4' => 'audio/mp4',
            'mp3' => 'audio/mpeg',
            'wav' => 'audio/wav',
            'aac' => 'audio/aac',
            default => $mime,
        };
    }

    /** * AAC in an m4a container through ffmpeg; null when it is not installed or fails. */
    private function toAac(string $data): ?string
    {
        $input = tempnam(sys_get_temp_dir(), 'voice-in-');
        $output = $input.'.m4a';

        try {
            file_put_contents($input, $data);
            $result = Process::timeout(30)->run([(string) config('services.ffmpeg.binary', 'ffmpeg'), '-y', '-v', 'error', '-i', $input, '-vn', '-c:a', 'aac', '-b:a', '64k', $output]);
            $converted = $result->successful() && is_file($output) ? file_get_contents($output) : false;

            return $converted === false || $converted === '' ? null : $converted;
        } catch (\Throwable) {
            return null;
        } finally {
            @unlink($input);
            @unlink($output);
        }
    }

    /** * Flattens transparency onto white; null when the image cannot be decoded (the original is sent as it is). */
    private function webpToJpeg(string $data): ?string
    {
        $source = function_exists('imagecreatefromstring') ? @imagecreatefromstring($data) : false;

        if ($source === false) {
            return null;
        }

        $canvas = imagecreatetruecolor(imagesx($source), imagesy($source));
        imagefill($canvas, 0, 0, (int) imagecolorallocate($canvas, 255, 255, 255));
        imagecopy($canvas, $source, 0, 0, 0, 0, imagesx($source), imagesy($source));

        ob_start();
        imagejpeg($canvas, null, 90);

        return (string) ob_get_clean();
    }

    private function settle(ChatMessage $message, string $status, string $error): ChatMessage
    {
        $message->forceFill(['send_status' => $status, 'error' => Str::limit($error, self::ERROR_LENGTH)])->save();

        return $message;
    }
}
