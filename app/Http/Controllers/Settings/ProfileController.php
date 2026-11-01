<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\ProfileDeleteRequest;
use App\Http\Requests\Settings\ProfileUpdateRequest;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;

class ProfileController extends Controller
{
    /**
     * Show the user's profile settings page.
     */
    public function edit(Request $request): Response
    {
        return Inertia::render('settings/profile', [
            'mustVerifyEmail' => $request->user() instanceof MustVerifyEmail,
            'status' => $request->session()->get('status'),
        ]);
    }

    /**
     * Update the user's profile information.
     */
    public function update(ProfileUpdateRequest $request): RedirectResponse|JsonResponse
    {
        $user = $request->user();

        $user->fill($request->safe()->only(['name', 'email', 'phone']));

        if ($user->isDirty('email')) {
            $user->email_verified_at = null;
        }

        if ($request->hasFile('profile_url')) {
            $disk = Storage::disk('public');

            if (! $disk->exists('avatars')) {
                $disk->makeDirectory('avatars');
            }

            if ($user->avatar) {
                $disk->delete($user->avatar);
            }

            $user->avatar = $request->file('profile_url')->store('avatars', 'public');
        }

        $user->save();

        if ($request->wantsJson()) {
            return response()->json(['message' => __('Profile updated.')]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Profile updated.')]);

        return to_route('profile.edit');
    }

    /**
     * Delete the user's profile.
     */
    public function destroy(ProfileDeleteRequest $request): RedirectResponse|JsonResponse
    {
        $user = $request->user();

        Auth::logout();

        $user->delete();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        // * A JSON response can't redirect: the session is already destroyed, so the frontend hard-navigates on success.
        if ($request->wantsJson()) {
            return response()->json(['message' => __('Account deleted.'), 'redirect' => '/']);
        }

        return redirect('/');
    }
}
