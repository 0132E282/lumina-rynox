<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Admin;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Fortify\Features;
use Laravel\Fortify\RecoveryCode;
use Laravel\Fortify\TwoFactorAuthenticationProvider;

class AdminFactory extends Factory
{
    protected $model = Admin::class;

    /** * Cached so every factory-created admin shares one bcrypt hash of "password" instead of hashing per row. */
    protected static ?string $password = null;

    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'system_admin' => false,
            'password' => static::$password ??= Hash::make('password'),
            'remember_token' => Str::random(10),
        ];
    }

    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    public function withTwoFactor(?string $secret = null, ?array $recoveryCodes = null): static
    {
        if (! Features::canManageTwoFactorAuthentication()) {
            return $this->state([]);
        }

        return $this->state(fn (array $attributes) => [
            'two_factor_secret' => Crypt::encryptString($secret ?: app(TwoFactorAuthenticationProvider::class)->generateSecretKey()),
            'two_factor_recovery_codes' => Crypt::encryptString(json_encode($recoveryCodes ?: Collection::times(8, fn () => RecoveryCode::generate())->all())),
            'two_factor_confirmed_at' => now(),
        ]);
    }
}
