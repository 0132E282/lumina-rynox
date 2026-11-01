<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\Admin;
use App\Models\AiAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

abstract class AiTestCase extends TestCase
{
    use RefreshDatabase;

    protected const SECRET = 'sk-test-SECRET-1234567890';

    /** @param array<string, mixed> $attributes */
    protected function account(array $attributes = []): AiAccount
    {
        return AiAccount::query()->create([
            'name' => 'Main',
            'vendor' => 'anthropic',
            'auth_type' => AiAccount::AUTH_API,
            'credentials' => ['token' => self::SECRET],
            'priority' => 100,
            ...$attributes,
        ]);
    }

    protected function admin(bool $system = true): Admin
    {
        return Admin::factory()->create(['system_admin' => $system]);
    }
}
