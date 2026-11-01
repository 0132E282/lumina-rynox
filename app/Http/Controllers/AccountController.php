<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AccountController extends Controller
{
    /** * Heartbeat: logs the admin out if the account was locked since login. */
    public function check(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['authenticated' => false], 401);
        }

        if ($user->isLocked()) {
            $user->forceFill(['last_seen_at' => null])->save();

            Auth::guard($request->input('guard') ?? 'web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['authenticated' => false, 'locked' => true], 423);
        }

        $user->forceFill(['last_seen_at' => now()])->save();

        return response()->json(['authenticated' => true, 'locked' => false]);
    }
}
