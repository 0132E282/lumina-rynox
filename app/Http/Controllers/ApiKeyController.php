<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\ApiKey;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ApiKeyController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('api-keys/index', [
            'apiKeys' => ApiKey::query()->latest()->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => 'required|string|max:255',
        ]);

        $apiKey = ApiKey::generateKey($request->input('name'));

        return response()->json([
            'message' => 'Tạo API Key thành công.',
            'data' => $apiKey,
        ], 201);
    }

    public function revoke(int $id): JsonResponse
    {
        $apiKey = ApiKey::query()->findOrFail($id);
        $apiKey->update(['status' => 'revoked']);

        return response()->json([
            'message' => 'Đã thu hồi API Key.',
            'data' => $apiKey,
        ]);
    }

    public function destroy(int $id): JsonResponse
    {
        ApiKey::query()->findOrFail($id)->delete();

        return response()->json(null, 204);
    }
}
