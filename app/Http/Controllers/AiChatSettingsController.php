<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\SaveAiChatSettingsRequest;
use App\Models\Admin;
use App\Models\AiChatSetting;
use App\Services\Ai\AssistantAvatarStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** * Chat customisation of the signed-in admin only: every query is keyed by their own id, and only their own fields come back. */
class AiChatSettingsController extends Controller
{
    public function __construct(private readonly AssistantAvatarStore $avatars) {}

    public function update(SaveAiChatSettingsRequest $request): JsonResponse
    {
        $user = $this->admin($request);
        $data = collect($request->validated())->map(fn (mixed $value): mixed => is_string($value) && trim($value) === '' ? null : $value)->all();

        AiChatSetting::query()->updateOrCreate(['user_id' => $user->id], $data + array_fill_keys(['custom_instructions', 'display_name', 'assistant_name', 'assistant_icon', 'assistant_color'], null));

        return response()->json(['settings' => AiChatSetting::payloadFor($user)]);
    }

    /** * Replaces the assistant's uploaded avatar; the previous file is deleted once the new one is saved. */
    public function uploadAvatar(Request $request): JsonResponse
    {
        $user = $this->admin($request);
        $request->validate(['avatar' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp,gif', 'max:'.(AssistantAvatarStore::MAX_BYTES / 1024), 'dimensions:max_width='.AssistantAvatarStore::MAX_SIDE.',max_height='.AssistantAvatarStore::MAX_SIDE]], [
            'avatar.*' => 'Ảnh không hợp lệ (chỉ nhận jpg, png, webp, gif tối đa 1 MB và 2048 px).',
        ]);

        try {
            $path = $this->avatars->store($user->id, $request->file('avatar'));
        } catch (RuntimeException $exception) {
            throw ValidationException::withMessages(['avatar' => $exception->getMessage()]);
        }

        $previous = AiChatSetting::query()->where('user_id', $user->id)->value('avatar_path');
        $row = AiChatSetting::query()->firstOrNew(['user_id' => $user->id]);
        $row->avatar_path = $path;
        $row->save();
        $this->avatars->delete($previous);

        return response()->json(['settings' => AiChatSetting::payloadFor($user)]);
    }

    public function removeAvatar(Request $request): JsonResponse
    {
        $user = $this->admin($request);
        $row = AiChatSetting::query()->where('user_id', $user->id)->first();

        if ($row?->avatar_path !== null) {
            $this->avatars->delete($row->avatar_path);
            $row->update(['avatar_path' => null]);
        }

        return response()->json(['settings' => AiChatSetting::payloadFor($user)]);
    }

    /** * Serves the signed-in admin's own avatar only (the path comes from their own row and must match the fixed pattern). */
    public function avatar(Request $request): StreamedResponse
    {
        $path = AiChatSetting::forUser($this->admin($request))?->avatar_path;
        $disk = Storage::disk(AssistantAvatarStore::DISK);

        if ($path === null || preg_match(AssistantAvatarStore::PATH_PATTERN, $path) !== 1 || ! $disk->exists($path)) {
            abort(404);
        }

        return $disk->response($path, null, [
            'Content-Type' => AssistantAvatarStore::MIMES[pathinfo($path, PATHINFO_EXTENSION)],
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=86400',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], 'inline');
    }

    /** * "Khôi phục mặc định": drops the row (and its avatar file), so every field reads as its default again. */
    public function destroy(Request $request): JsonResponse
    {
        $user = $this->admin($request);

        $this->avatars->delete(AiChatSetting::query()->where('user_id', $user->id)->value('avatar_path'));
        AiChatSetting::query()->where('user_id', $user->id)->delete();

        return response()->json(['settings' => AiChatSetting::payloadFor($user)]);
    }

    private function admin(Request $request): Admin
    {
        $user = $request->user();

        abort_unless($user instanceof Admin, 403);

        return $user;
    }
}
