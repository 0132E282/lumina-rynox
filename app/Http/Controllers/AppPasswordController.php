<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AppPasswordGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AppPasswordController extends Controller
{
    public function status(): JsonResponse
    {
        return response()->json(['confirmed' => AppPasswordGate::confirmed()]);
    }

    public function confirm(Request $request): JsonResponse
    {
        $request->validate(['password' => ['required', 'string']]);

        if (! AppPasswordGate::attempt($request->string('password')->toString())) {
            return response()->json(['message' => 'Mật khẩu không đúng.'], 422);
        }

        return response()->json([], 201);
    }
}
