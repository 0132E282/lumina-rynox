<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A GitHub repo (`owner/name`) an admin added to the Code tab's project list.
 *
 * @property int $user_id
 * @property string $repo
 */
class AiProject extends Model
{
    protected $fillable = ['user_id', 'repo'];
}
