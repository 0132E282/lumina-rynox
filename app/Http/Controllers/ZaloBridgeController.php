<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Jobs\SyncZaloContactsJob;
use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\Zalo\ZaloChannel;
use App\Services\Chat\Zalo\ZaloInbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

// ! Endpoints for the Zalo sidecar only. Never log a request body or the credentials; answers about the session carry `no-store`.
class ZaloBridgeController extends Controller
{
    public function __construct(
        private readonly ZaloChannel $channel,
        private readonly ZaloInbox $inbox,
    ) {}

    /** * The sidecar signed in one account with a QR code: keep that account's session (encrypted by the model cast) and mark it connected. */
    public function storeSession(Request $request): Response
    {
        $data = $request->validate([
            'credentials' => ['required', 'array'],
            'credentials.cookie' => ['required', 'string', 'max:20000'],
            'credentials.imei' => ['required', 'string', 'max:20000'],
            'credentials.user_agent' => ['required', 'string', 'max:20000'],
            'account' => ['required', 'array'],
            'account.uid' => ['required', 'string', 'max:64'],
            'account.name' => ['nullable', 'string', 'max:255'],
        ]);

        $integration = $this->channel->integration();

        // * The session is only accepted after the risk was acknowledged on the integration page.
        if ($integration === null || ! ($integration->settings['risk_acknowledged'] ?? false)) {
            return response(null, 409);
        }

        $account = ZaloAccount::query()->firstOrNew(['account_key' => $data['account']['uid']]);

        $account->forceFill([
            'integration_id' => $integration->id,
            'credentials' => [
                'cookie' => $data['credentials']['cookie'],
                'imei' => $data['credentials']['imei'],
                'user_agent' => $data['credentials']['user_agent'],
            ],
            'status' => Integration::STATUS_CONNECTED,
            'last_error' => null,
            // * A re-login of a known account keeps its name when the sidecar did not learn one.
            'name' => $data['account']['name'] ?? $account->name,
            'bridge_state_at' => now(),
            'connected_at' => now(),
            // * A new sign-in gets one automatic address book sync once the sidecar reports `running`.
            'contacts_synced_at' => null,
        ])->save();

        $this->channel->refreshStatus($integration);

        return response(null, 204);
    }

    /** * The sidecar asks for one account's stored session when it starts, so a restart needs no new QR scan. */
    public function showSession(Request $request): JsonResponse
    {
        $account = $this->channel->accountForKey(is_string($request->query('account')) ? $request->query('account') : null);
        $credentials = $account === null ? null : $this->channel->credentials($account);

        if ($account === null || $credentials === null || $account->status === Integration::STATUS_DISCONNECTED) {
            return response()->json(['message' => 'Chưa có phiên Zalo.'], 404);
        }

        return response()->json(['credentials' => $credentials])->header('Cache-Control', 'no-store');
    }

    /** * Keys of the accounts the sidecar should restore at start. */
    public function accounts(): JsonResponse
    {
        return response()->json(['accounts' => $this->channel->sessionKeys()])->header('Cache-Control', 'no-store');
    }

    /** * Bridge state change of one account (running, session lost, displaced...). Failures become a fixed Vietnamese `last_error`, never the sidecar's text. */
    public function status(Request $request): Response
    {
        $data = $request->validate([
            'account' => ['nullable', 'string', 'max:64'],
            'state' => ['required', 'string', Rule::in(ZaloChannel::STATES)],
            'reason_code' => ['nullable', 'string', Rule::in(array_keys(ZaloChannel::ERROR_MESSAGES))],
        ]);

        $account = $this->channel->accountForKey($data['account'] ?? null);

        if ($account !== null) {
            $this->channel->markAccountState($account, $data['state'], $data['reason_code'] ?? null);

            // * Once per sign-in, after the response so the sidecar's callback is not held up.
            if ($data['state'] === 'running' && $account->contacts_synced_at === null && $account->status === Integration::STATUS_CONNECTED) {
                SyncZaloContactsJob::dispatchAfterResponse($account->id);
            }
        }

        return response(null, 204);
    }

    /**
     * A message one account received. Answers 200 `stored: false` for anything filtered or already stored, so the sidecar does not resend;
     * a validation error is 422 (the sidecar drops it), a server error makes the sidecar queue it again.
     */
    public function inbound(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account' => ['nullable', 'string', 'max:64'],
            'message_id' => ['required', 'string', 'max:64'],
            'thread_id' => ['required', 'string', 'max:64'],
            'thread_type' => ['required', 'string', Rule::in(['user', 'group'])],
            'thread_name' => ['nullable', 'string', 'max:255'],
            'sender_id' => ['required', 'string', 'max:64'],
            'sender_name' => ['nullable', 'string', 'max:255'],
            'is_self' => ['required', 'boolean'],
            'content_type' => ['required', 'string', Rule::in(ZaloInbox::CONTENT_TYPES)],
            'text' => ['nullable', 'string', 'max:20000'],
            'mentions_self' => ['required', 'boolean'],
            'sent_at_ms' => ['required', 'integer', 'min:0'],
        ]);

        $account = $this->channel->accountForKey($data['account'] ?? null);

        return response()->json(['stored' => $account !== null && $this->inbox->ingest($account, [
            'message_id' => $data['message_id'],
            'thread_id' => $data['thread_id'],
            'thread_type' => $data['thread_type'],
            'thread_name' => $data['thread_name'] ?? null,
            'sender_id' => $data['sender_id'],
            'sender_name' => $data['sender_name'] ?? null,
            'is_self' => (bool) $data['is_self'],
            'content_type' => $data['content_type'],
            'text' => $data['text'] ?? null,
            'mentions_self' => (bool) $data['mentions_self'],
            'sent_at_ms' => (int) $data['sent_at_ms'],
        ])]);
    }
}
