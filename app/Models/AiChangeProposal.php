<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One file edit the AI proposed for a GitHub repo. It stays `pending` until the person approves it in the chat.
 *
 * @property int $id
 * @property int $ai_message_id
 * @property string $repo `owner/name`
 * @property string $base_branch
 * @property string $path path inside the repo
 * @property string $action `create|update`
 * @property string|null $base_sha
 * @property string $content full new content of the file
 * @property string|null $diff
 * @property string $status `pending|applied|rejected|reverted`
 * @property string|null $pull_url
 */
class AiChangeProposal extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_APPLIED = 'applied';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_REVERTED = 'reverted';

    public const MAX_FILES = 10;

    public const MAX_CONTENT_BYTES = 100000;

    protected $fillable = ['ai_message_id', 'repo', 'base_branch', 'path', 'action', 'base_sha', 'content', 'diff', 'status', 'pull_url'];

    /** @return BelongsTo<AiMessage, $this> */
    public function message(): BelongsTo
    {
        return $this->belongsTo(AiMessage::class, 'ai_message_id');
    }

    /**
     * A path the AI may touch: relative, plain characters, never `.git` or CI workflows (a changed workflow runs code with the repo's secrets).
     */
    public static function safePath(string $path): ?string
    {
        $path = trim($path);

        if ($path === '' || mb_strlen($path) > 300 || preg_match('#^[A-Za-z0-9._@+/-]+$#', $path) !== 1) {
            return null;
        }

        if (str_starts_with($path, '/') || str_ends_with($path, '/') || str_contains($path, '..') || str_contains($path, '//')) {
            return null;
        }

        if (preg_match('#^\.git(/|$)#i', $path) === 1 || preg_match('#^\.github/workflows(/|$)#i', $path) === 1) {
            return null;
        }

        return $path;
    }
}
