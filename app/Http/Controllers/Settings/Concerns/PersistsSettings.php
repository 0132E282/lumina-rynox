<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings\Concerns;

use App\Models\Setting;
use Illuminate\Http\Request;

trait PersistsSettings
{
    /** @param array<string, mixed> $values */
    protected function persistSettings(Request $request, array $values, string $activityMessage): void
    {
        foreach ($values as $key => $value) {
            Setting::set($key, $value);
        }

        activity()
            ->causedBy($request->user())
            ->event('updated')
            ->log($activityMessage);
    }
}
