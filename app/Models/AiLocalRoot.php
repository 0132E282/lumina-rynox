<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One imported local folder of one admin. The absolute path stays on the server (hidden from every serialisation).
 *
 * @property int $id
 * @property int $user_id
 * @property string $project display name shared by the folders of one project
 * @property string $key root id used by the local workspace API
 * @property string $path
 */
class AiLocalRoot extends Model
{
    protected $fillable = ['user_id', 'project', 'key', 'path'];

    protected $hidden = ['path'];
}
