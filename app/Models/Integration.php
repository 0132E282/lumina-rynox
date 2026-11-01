<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Integration extends Model
{
    public const STATUS_CONNECTED = 'connected';

    public const STATUS_ERROR = 'error';

    public const STATUS_DISCONNECTED = 'disconnected';

    public const STATUS_LABELS = [
        self::STATUS_CONNECTED => 'Đã kết nối',
        self::STATUS_ERROR => 'Lỗi kết nối',
        self::STATUS_DISCONNECTED => 'Chưa kết nối',
    ];

    protected $fillable = [
        'provider',
        'status',
        'credentials',
        'settings',
        'meta',
        'last_checked_at',
        'last_error',
    ];

    // ! Secrets never leave the server: `credentials` is hidden and only `maskedSecrets()` reaches the client.
    protected $hidden = ['credentials'];

    protected $casts = [
        'credentials' => 'encrypted:array',
        'settings' => 'array',
        'meta' => 'array',
        'last_checked_at' => 'datetime',
    ];

    /** * Bullets plus the last 4 characters; a value too short to hide safely is fully masked. */
    public static function mask(string $secret): string
    {
        $visible = mb_strlen($secret) >= 8 ? mb_substr($secret, -4) : '';

        return str_repeat('•', 16).$visible;
    }

    /** @return array<string, string> secret key => masked value */
    public function maskedSecrets(): array
    {
        return collect($this->credentials ?? [])
            ->filter(fn (mixed $secret): bool => is_string($secret) && $secret !== '')
            ->map(fn (string $secret, string $key): string => $key === 'cookies' ? str_repeat('•', 16) : self::mask($secret))
            ->all();
    }
}
