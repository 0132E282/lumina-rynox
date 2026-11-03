<?php

declare(strict_types=1);

namespace App\Services\Ai;

use RuntimeException;

/**
 * * Every AI failure reaches the user as one of these fixed texts. Vendor bodies, URLs, keys and the original exception are never carried along
 * * (a request URL or error body can contain the key), so nothing here can leak through a response or a log line.
 */
final class AiException extends RuntimeException
{
    /**
     * @param  QuotaLimit|null  $limit  for a quota stop only: the kind of limit and reset time the error stated (no text)
     * @param  string|null  $detail  where it stopped, in our own words (the way of calling, the time limit, the exit code): never text taken from the vendor's reply
     */
    public function __construct(string $message, public readonly ?QuotaLimit $limit = null, public readonly ?string $detail = null)
    {
        parent::__construct($message);
    }

    public const NOT_CONFIGURED = 'Chưa cấu hình trợ lý AI.';

    public const NO_KEY = 'Chưa lưu API key cho nhà cung cấp đã chọn.';

    public const UNAUTHORIZED = 'API key không hợp lệ hoặc đã bị thu hồi.';

    public const TIMEOUT = 'AI phản hồi quá chậm, hãy thử lại sau.';

    public const QUOTA = 'Tài khoản AI đã hết hạn mức hoặc bị giới hạn tốc độ.';

    public const FAILED = 'AI trả về lỗi, hãy thử lại sau.';

    public const EMPTY = 'AI không trả về nội dung.';

    public const CLI_UNAVAILABLE = 'Không chạy được CLI AI trên máy chủ này (chưa cài hoặc chưa đăng nhập).';

    public const CLI_NOT_LOGGED_IN = 'CLI AI chạy được nhưng chưa đăng nhập với user của web server. Chạy `claude login` (hoặc `codex login`) bằng đúng user chạy PHP, rồi khởi động lại server.';

    public const CLI_NOT_FOUND = 'Không tìm thấy lệnh CLI AI trên máy chủ này. Cài CLI hoặc đặt AI_CLI_PATH trong .env.';

    public const CLI_UNSUPPORTED = 'Nhà cung cấp này không có CLI, hãy chọn cách gọi API key.';

    public const NO_MESSAGES = 'Hội thoại chưa có tin nhắn để gợi ý.';

    /** The fixed text, plus the reset time of a quota stop when the vendor's error stated one. */
    public function userMessage(): string
    {
        $resetAt = $this->getMessage() === self::QUOTA ? $this->limit?->resetAt : null;
        $text = $resetAt === null ? $this->getMessage() : $this->getMessage().' Thời gian reset: '.$resetAt->format('H:i d/m/Y').'.';

        return $this->detail === null ? $text : $text.' ('.$this->detail.')';
    }

    /** A short class of the failure for the usage log: derived from the fixed text, so nothing of the vendor's own error is kept. */
    public function kind(): string
    {
        return match ($this->getMessage()) {
            self::QUOTA => 'quota',
            self::UNAUTHORIZED, self::NO_KEY => 'unauthorized',
            self::TIMEOUT => 'timeout',
            self::EMPTY => 'empty',
            self::FAILED => 'failed',
            self::CLI_UNAVAILABLE, self::CLI_NOT_LOGGED_IN, self::CLI_NOT_FOUND, self::CLI_UNSUPPORTED => 'cli',
            default => 'other',
        };
    }
}
