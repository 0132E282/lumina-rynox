<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\Zalo\ZaloBridgeClient;
use App\Services\Chat\Zalo\ZaloBridgeException;
use App\Services\Chat\Zalo\ZaloChannel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;

/**
 * QR sign-in for Zalo, proxied to the sidecar so the browser never talks to it. Needs `integrations.update` (route middleware).
 * ! The QR image and the session are credentials: never log them, never cache the answers.
 */
class ZaloLoginController extends Controller
{
    private const LOGIN_ID_RULE = ['required', 'string', 'regex:/^[A-Za-z0-9-]{1,64}$/'];

    // * Scopes chosen in the "add account" dialog wait here (by login id) until the sidecar reports which account signed in.
    private const PENDING_TTL_SECONDS = 600;

    private const BRIDGE_DOWN = 'Zalo bridge không chạy. Chạy npm --prefix zalo-bridge start rồi thử lại.';

    private const BRIDGE_ERROR = 'Zalo bridge trả về lỗi, hãy thử lại sau.';

    public function __construct(
        private readonly ZaloBridgeClient $bridge,
        private readonly ZaloChannel $channel,
    ) {}

    /** * Starts a QR session for a NEW account (other accounts keep running); the previous pending QR is cancelled by the sidecar. */
    public function start(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'risk_acknowledged' => ['accepted'],
            'permissions' => ['sometimes', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(ZaloAccount::PERMISSIONS)],
            'group_mode' => ['sometimes', 'string', Rule::in(ZaloAccount::GROUP_MODES)],
        ]);

        try {
            $loginId = $this->bridge->qrStart();
        } catch (ConnectionException) {
            return $this->unavailable(503, self::BRIDGE_DOWN);
        } catch (ZaloBridgeException) {
            return $this->unavailable(502, self::BRIDGE_ERROR);
        }

        $this->rememberRiskAcknowledged();
        Cache::put($this->pendingKey($loginId), [
            'permissions' => isset($validated['permissions']) ? array_values($validated['permissions']) : null,
            'group_mode' => $validated['group_mode'] ?? null,
        ], self::PENDING_TTL_SECONDS);

        return response()->json(['login_id' => $loginId])->header('Cache-Control', 'no-store');
    }

    public function status(Request $request): JsonResponse
    {
        $loginId = $request->validate(['login_id' => self::LOGIN_ID_RULE])['login_id'];

        try {
            $status = $this->bridge->qrStatus($loginId);
        } catch (ConnectionException) {
            return $this->unavailable(503, self::BRIDGE_DOWN);
        } catch (ZaloBridgeException $exception) {
            return $exception->status === 404
                ? response()->json(['state' => 'error', 'image' => null, 'error_code' => 'not_found'])->header('Cache-Control', 'no-store')
                : $this->unavailable(502, self::BRIDGE_ERROR);
        }

        if ($status['state'] === 'logged_in') {
            $account = $status['account_key'] === null ? null : $this->channel->accountForKey($status['account_key']);
            $status['account_name'] = $account?->name;

            if ($account !== null) {
                $this->applyChosenSettings($account, $loginId);
            }
        }

        // * The uid is only a key between this app and the sidecar; the browser does not need it.
        unset($status['account_key']);

        return response()->json($status)->header('Cache-Control', 'no-store');
    }

    /** * Best effort: a sidecar that is down or has already forgotten the session leaves nothing to cancel. */
    public function cancel(Request $request): Response
    {
        $loginId = $request->validate(['login_id' => self::LOGIN_ID_RULE])['login_id'];

        try {
            $this->bridge->qrCancel($loginId);
        } catch (ConnectionException|ZaloBridgeException) {
            // * Nothing to undo: an unreachable sidecar has no pending QR session.
        }

        return response(null, 204);
    }

    /** * The scopes and group mode ticked before the QR was scanned apply to the account that signed in (taken once). */
    private function applyChosenSettings(ZaloAccount $account, string $loginId): void
    {
        $chosen = Cache::pull($this->pendingKey($loginId));

        if (! is_array($chosen)) {
            return;
        }

        $account->forceFill(array_filter([
            'permissions' => $chosen['permissions'] ?? null,
            'group_mode' => $chosen['group_mode'] ?? null,
        ], fn (mixed $value): bool => $value !== null))->save();
    }

    private function pendingKey(string $loginId): string
    {
        return 'zalo:login:'.$loginId;
    }

    /** * The risk tick is stored once the sidecar accepted the request, so `POST /internal/zalo/session` can be accepted afterwards. */
    private function rememberRiskAcknowledged(): void
    {
        $integration = $this->channel->integration() ?? new Integration(['provider' => ZaloChannel::PROVIDER, 'status' => Integration::STATUS_DISCONNECTED]);
        $settings = $integration->settings ?? [];

        $settings['fields'] ??= [];
        $settings['risk_acknowledged'] = true;

        $integration->fill(['settings' => $settings])->save();
    }

    private function unavailable(int $status, string $message): JsonResponse
    {
        return response()->json(['message' => $message], $status)->header('Cache-Control', 'no-store');
    }
}
