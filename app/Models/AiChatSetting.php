<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * One admin's chat customisation. Always read through `forUser()`: a row is only ever found by the signed-in admin's own id.
 *
 * @property int $id
 * @property int $user_id
 * @property string|null $custom_instructions
 * @property string|null $display_name how the AI addresses the person
 * @property string|null $assistant_name
 * @property string|null $assistant_icon one of ICONS
 * @property string|null $assistant_color one of COLORS
 * @property string|null $avatar_path private-disk path of the uploaded avatar (never sent to the client)
 * @property Carbon|null $updated_at
 */
class AiChatSetting extends Model
{
    public const MAX_INSTRUCTIONS = 8000;

    public const MAX_DISPLAY_NAME = 60;

    public const MAX_ASSISTANT_NAME = 40;

    /** Fixed avatar choices; the client keeps the same lists in `resources/js/lib/assistant-avatar.ts`. */
    public const ICONS = ['sparkles', 'bot', 'brain', 'zap', 'rocket', 'leaf'];

    public const COLORS = ['primary', 'blue', 'green', 'amber', 'rose', 'violet'];

    protected $fillable = ['user_id', 'custom_instructions', 'display_name', 'assistant_name', 'assistant_icon', 'assistant_color', 'avatar_path'];

    /**
     * This admin's row, or null when there is none. Before the table exists (migration not run yet) it reads as none, so the chat still opens with defaults.
     */
    public static function forUser(Admin $user): ?self
    {
        try {
            return self::query()->where('user_id', $user->id)->first();
        } catch (QueryException $exception) {
            // * Only a missing table is tolerated here; any other database error still surfaces.
            if (Schema::hasTable('ai_chat_settings')) {
                throw $exception;
            }

            Log::notice('ai_chat_settings table is missing; using chat defaults.');

            return null;
        }
    }

    /** @return array{custom_instructions: string|null, display_name: string|null, assistant_name: string|null, assistant_icon: string|null, assistant_color: string|null, avatar_url: string|null} */
    public static function payloadFor(Admin $user): array
    {
        $row = self::forUser($user);

        return [
            'custom_instructions' => $row?->custom_instructions,
            'display_name' => $row?->display_name,
            'assistant_name' => $row?->assistant_name,
            'assistant_icon' => $row?->assistant_icon,
            'assistant_color' => $row?->assistant_color,
            // * Only the serving route (with a cache-busting version), never the disk path.
            'avatar_url' => $row?->avatar_path === null ? null : route('ai-chat.settings.avatar', ['v' => $row->updated_at?->timestamp]),
        ];
    }
}
