<?php

declare(strict_types=1);

namespace App\Models;

use App\Concerns\QueryBuilder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ApiKey extends Model
{
    use HasFactory, QueryBuilder;

    protected $table = 'api_keys';

    protected $fillable = [
        'name',
        'key',
        'secret',
        'status',
        'last_used_at',
    ];

    protected $casts = [
        'last_used_at' => 'datetime',
    ];

    public static function generateKey(string $name): self
    {
        $rawToken = 'lum_pk_'.Str::random(32);

        return self::create([
            'name' => $name,
            'key' => $rawToken,
            'secret' => 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI'.Str::random(32),
            'status' => 'active',
        ]);
    }
}
