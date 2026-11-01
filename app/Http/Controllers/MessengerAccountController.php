<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Matrix\BridgeProvisioningClient;
use App\Services\Chat\Matrix\MatrixException;
use App\Services\Chat\Messenger\MessengerChannel;
use App\Services\Chat\Messenger\MessengerConversationPurger;
use App\Services\Chat\Messenger\MessengerInbox;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Per-account actions of the Messenger channel: view a profile picture (`integrations.view`) and disconnect one
 * account (`integrations.update`), both enforced by route middleware. Disconnecting also deletes that account's conversations, their messages and stored files; other accounts are untouched.
 */
class MessengerAccountController extends Controller
{
    // * Only paths the inbox generates are ever read back from disk.
    private const AVATAR_PATH_PATTERN = '#^chat/avatars/accounts/\d+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$#D';

    private const MIMES = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];

    public function __construct(
        private readonly BridgeProvisioningClient $bridge,
        private readonly MessengerChannel $channel,
        private readonly MessengerConversationPurger $purger,
    ) {}

    public function avatar(MessengerAccount $account): StreamedResponse
    {
        $path = $account->avatar_path;
        $disk = Storage::disk(MessengerInbox::ATTACHMENT_DISK);

        if ($path === null || preg_match(self::AVATAR_PATH_PATTERN, $path) !== 1 || ! $disk->exists($path)) {
            abort(404);
        }

        return $disk->response($path, null, [
            'Content-Type' => self::MIMES[pathinfo($path, PATHINFO_EXTENSION)],
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=86400',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], 'inline');
    }

    /** * Replaces the scopes of one account; other accounts and the cookie/login are untouched. */
    public function update(Request $request, MessengerAccount $account): RedirectResponse
    {
        $validated = $request->validate([
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(MessengerAccount::PERMISSIONS)],
        ]);

        $account->forceFill(['permissions' => array_values($validated['permissions'])])->save();

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã lưu quyền của tài khoản Messenger.']);

        return to_route('integrations.show', ['provider' => MessengerChannel::PROVIDER]);
    }

    public function destroy(MessengerAccount $account): RedirectResponse
    {
        try {
            $this->bridge->logout($account->login_id);
        } catch (ConnectionException|MatrixException) {
            // * Best effort: a bridge that is down or already forgot the login leaves nothing to log out; the account is marked disconnected either way.
        }

        $this->purger->purge($account);

        $account->forceFill([
            'status' => Integration::STATUS_DISCONNECTED,
            'last_error' => null,
            'bridge_state' => null,
            'bridge_state_at' => now(),
        ])->save();
        $this->channel->refreshStatus($account->integration);

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã ngắt kết nối tài khoản Messenger.']);

        return to_route('integrations.show', ['provider' => MessengerChannel::PROVIDER]);
    }

    /** * Deletes the record of an already disconnected account; the bridge login was logged out when it was disconnected. */
    public function forget(MessengerAccount $account): RedirectResponse
    {
        abort_unless($account->status === Integration::STATUS_DISCONNECTED, 409, 'Chỉ xoá được tài khoản đã ngắt kết nối.');

        // * Conversations are normally purged at disconnect; this clears leftovers so none is left orphaned by the FK's nullOnDelete.
        $this->purger->purge($account);

        if ($account->avatar_path !== null && preg_match(self::AVATAR_PATH_PATTERN, $account->avatar_path) === 1) {
            Storage::disk(MessengerInbox::ATTACHMENT_DISK)->delete($account->avatar_path);
        }

        $account->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã xoá tài khoản Messenger.']);

        return to_route('integrations.show', ['provider' => MessengerChannel::PROVIDER]);
    }
}
