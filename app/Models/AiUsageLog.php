<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One AI call: account, model, purpose and outcome only (no prompt, answer or vendor error text). */
class AiUsageLog extends Model
{
    public const STATUS_OK = 'ok';

    public const STATUS_ERROR = 'error';

    public const STATUS_QUOTA = 'quota';

    public const UPDATED_AT = null;

    protected $fillable = ['ai_account_id', 'user_id', 'purpose', 'model', 'status', 'error_kind', 'tokens_in', 'tokens_out'];
}
