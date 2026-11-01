<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;

/**
 * A group the personal Facebook / LinkedIn account has joined, read once from the real Chrome (never from an official API).
 *
 * @property int $id
 * @property string $provider
 * @property string $external_id
 * @property string $name
 * @property string $url
 * @property string|null $image_url
 * @property Carbon $synced_at
 * @property Carbon|null $left_at set when a sync no longer finds the group
 */
class SocialGroup extends Model
{
    protected $fillable = ['provider', 'external_id', 'name', 'url', 'image_url', 'synced_at', 'left_at'];

    protected $casts = ['synced_at' => 'datetime', 'left_at' => 'datetime'];
}
