<?php

declare(strict_types=1);

namespace App\Models;

use App\Concerns\QueryBuilder;
use Database\Factories\AdminFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Storage;
use Laravel\Fortify\Contracts\PasskeyUser;
use Laravel\Fortify\PasskeyAuthenticatable;
use Laravel\Fortify\TwoFactorAuthenticatable;
use Laravel\Passkeys\Passkeys;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;
use Spatie\Permission\Traits\HasRoles;

class Admin extends Authenticatable implements MustVerifyEmail, PasskeyUser
{
    /** @use HasFactory<AdminFactory> */
    use HasFactory, HasRoles, LogsActivity, Notifiable, PasskeyAuthenticatable, QueryBuilder, SoftDeletes, TwoFactorAuthenticatable;

    protected $fillable = [
        'name',
        'email',
        'phone',
        'password',
        'system_admin',
        'status',
        'metadata',
        'avatar',
    ];

    protected $hidden = [
        'password',
        'two_factor_secret',
        'two_factor_recovery_codes',
        'remember_token',
    ];

    protected $appends = [
        'profile_url',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'system_admin' => 'boolean',
            'metadata' => 'array',
            'last_login_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'two_factor_confirmed_at' => 'datetime',
        ];
    }

    public function getProfileUrlAttribute(): ?string
    {
        return $this->avatar ? Storage::disk('public')->url($this->avatar) : null;
    }

    /** * `passkeys.user_id` is the package's own column name — Eloquent would otherwise guess `admin_id` from this model's name. */
    public function passkeys(): HasMany
    {
        return $this->hasMany(Passkeys::passkeyModel(), 'user_id');
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['name', 'email', 'phone', 'status', 'system_admin'])
            ->logOnlyDirty()
            ->dontLogEmptyChanges();
    }

    public function isLocked(): bool
    {
        return $this->status === 'locked';
    }

    public function isOnline(): bool
    {
        return $this->last_seen_at !== null && $this->last_seen_at->gt(now()->subMinutes(2));
    }

    protected static function newFactory(): AdminFactory
    {
        return AdminFactory::new();
    }
}
