<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\Zalo\ZaloBridgeClient;
use App\Services\Chat\Zalo\ZaloBridgeException;
use App\Services\Chat\Zalo\ZaloChannel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;

/**
 * Per-account actions of the Zalo channel, both needing `integrations.update` (route middleware): change one account's scopes and
 * group mode, or disconnect it. Disconnecting never deletes conversations or messages and never touches other accounts.
 */
class ZaloAccountController extends Controller
{
    public function __construct(
        private readonly ZaloBridgeClient $bridge,
        private readonly ZaloChannel $channel,
    ) {}

    /** * Replaces the scopes (and group mode, when sent) of one account; the session and other accounts are untouched. */
    public function update(Request $request, ZaloAccount $account): RedirectResponse
    {
        $validated = $request->validate([
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(ZaloAccount::PERMISSIONS)],
            'group_mode' => ['sometimes', 'string', Rule::in(ZaloAccount::GROUP_MODES)],
        ]);

        $account->forceFill(array_filter([
            'permissions' => array_values($validated['permissions']),
            'group_mode' => $validated['group_mode'] ?? null,
        ], fn (mixed $value): bool => $value !== null))->save();

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã lưu quyền của tài khoản Zalo.']);

        return to_route('integrations.show', ['provider' => ZaloChannel::PROVIDER]);
    }

    public function destroy(ZaloAccount $account): RedirectResponse
    {
        try {
            $this->bridge->logout($account->account_key);
        } catch (ConnectionException|ZaloBridgeException) {
            // * Best effort: a sidecar that is down or already forgot the session leaves nothing to log out; the stored session is removed either way.
        }

        $account->forceFill([
            'credentials' => null,
            'status' => Integration::STATUS_DISCONNECTED,
            'last_error' => null,
            'bridge_state' => null,
            'bridge_state_at' => now(),
        ])->save();
        $this->channel->refreshStatus($account->integration);

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã ngắt kết nối tài khoản Zalo.']);

        return to_route('integrations.show', ['provider' => ZaloChannel::PROVIDER]);
    }
}
