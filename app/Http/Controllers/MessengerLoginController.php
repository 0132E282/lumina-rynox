<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Matrix\BridgeProvisioningClient;
use App\Services\Chat\Matrix\MatrixException;
use App\Services\Chat\Messenger\MessengerChannel;
use App\Services\Chat\Messenger\MessengerCookies;
use App\Services\Integrations\IntegrationManager;
use App\Services\Posting\FacebookBrowserScript;
use App\Services\Posting\FacebookWebSession;
use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * One-shot cookie sign-in for the Messenger bridge: `start` -> `step(cookies)` -> wait for `complete`, all inside
 * this one request. Needs `integrations.update` (route middleware).
 * ! The pasted cookie string is a Facebook login credential: never logged, never put in an exception message, never
 * ! flashed to the session (`bootstrap/app.php` also lists `cookies` in `dontFlash`), never stored (`credentials`
 * ! stays null on every path).
 *
 * @phpstan-import-type LoginStep from BridgeProvisioningClient
 */
class MessengerLoginController extends Controller
{
    private const FLOW_ID = 'facebook';

    private const LOCK_KEY = 'messenger-login';

    private const LOCK_SECONDS = 60;

    // * Total time budget for `display_and_wait` polling inside this one request.
    private const DISPLAY_AND_WAIT_BUDGET_SECONDS = 30;

    private const BRIDGE_ERROR = 'Messenger bridge trả về lỗi, hãy thử lại sau.';

    private const COOKIE_REJECTED = 'Facebook không chấp nhận cookie này. Hãy đăng nhập lại facebook.com và dán cookie mới.';

    private const UNSUPPORTED_STEP = 'Cách đăng nhập này chưa hỗ trợ.';

    /** @var list<string>|null scopes chosen in the sign-in dialog; null = keep the account's current ones (defaults for a new account) */
    private ?array $requestedPermissions = null;

    public function __construct(
        private readonly BridgeProvisioningClient $bridge,
        private readonly MessengerChannel $channel,
        private readonly IntegrationManager $integrations,
    ) {}

    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'risk_acknowledged' => ['accepted'],
            'cookies' => ['required', 'string', 'max:'.MessengerCookies::MAX_BYTES],
            'permissions' => ['nullable', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(MessengerAccount::PERMISSIONS)],
        ]);
        $this->requestedPermissions = isset($validated['permissions']) ? array_values($validated['permissions']) : null;

        $cookies = $this->parsedCookies((string) $validated['cookies']);

        return $this->withLock(fn (): array => $cookies, self::LOCK_SECONDS);
    }

    /**
     * Signs in through a Chrome window (Playwright) that opens on this machine: the person logs in to facebook.com there themselves,
     * then the cookies are read from that session, so nothing is pasted.
     * ! Only on this machine (loopback, not production): the browser opens here, and the session file holds live credentials.
     */
    public function loginFromBrowser(Request $request, FacebookBrowserScript $script, FacebookWebSession $session): JsonResponse
    {
        $validated = $request->validate([
            'risk_acknowledged' => ['accepted'],
            'permissions' => ['nullable', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(MessengerAccount::PERMISSIONS)],
        ]);
        $this->requestedPermissions = isset($validated['permissions']) ? array_values($validated['permissions']) : null;

        if (app()->isProduction() || ! in_array($request->server('REMOTE_ADDR'), ['127.0.0.1', '::1'], true)) {
            return $this->unavailable(422, 'Đăng nhập bằng trình duyệt chỉ dùng được khi mở app ngay trên máy này.');
        }

        if (! $this->channel->configured()) {
            return $this->unavailable(503, MessengerChannel::NOT_CONFIGURED);
        }

        // * The lock covers the whole run, Chrome window included: a second click cannot open a second window.
        return $this->withLock(fn (): array|JsonResponse => $this->browserCookies($script, $session) ?? $this->unavailable(422, 'Chưa đăng nhập được Facebook trong cửa sổ Chrome. Hãy đăng nhập facebook.com ở cửa sổ vừa mở rồi thử lại.'), self::LOCK_SECONDS + 420);
    }

    /**
     * @return array<string, string>|null the `c_user`/`xs` cookies of the logged-in Chrome; null when there is no login
     */
    private function browserCookies(FacebookBrowserScript $script, FacebookWebSession $session): ?array
    {
        // * Always opens the browser window (Playwright, the person's own Chrome profile): `login` returns once Facebook is signed in there, then `session` saves the fresh cookie header.
        if ($script->run('login')['status'] !== 'ok') {
            return null;
        }

        $outcome = $script->run('session');

        if (! ($outcome['status'] === 'ok' && ($outcome['payload']['loggedIn'] ?? false) === true)) {
            return null;
        }

        $header = $session->cookieHeader();

        try {
            $cookies = $header === null ? [] : MessengerCookies::parse($header);
        } catch (InvalidArgumentException) {
            return null;
        }

        return MessengerCookies::hasRequired($cookies, 'c_user', 'xs') ? $cookies : null;
    }

    /** @param Closure(): (array<string, string>|JsonResponse) $cookies the cookies to sign in with, or the response that refuses */
    private function withLock(Closure $cookies, int $seconds): JsonResponse
    {
        if (! $this->channel->configured()) {
            return $this->unavailable(503, MessengerChannel::NOT_CONFIGURED);
        }

        $lock = Cache::lock(self::LOCK_KEY, $seconds);

        if (! $lock->get()) {
            return $this->unavailable(409, 'Đang có một lượt đăng nhập Messenger khác, hãy thử lại sau.');
        }

        try {
            $resolved = $cookies();

            return $resolved instanceof JsonResponse ? $resolved : $this->signIn($resolved);
        } finally {
            $lock->release();
        }
    }

    /**
     * @return array<string, string>
     *
     * @throws ValidationException
     */
    private function parsedCookies(string $raw): array
    {
        try {
            $cookies = MessengerCookies::parse($raw);
        } catch (InvalidArgumentException $exception) {
            throw ValidationException::withMessages(['cookies' => $exception->getMessage()]);
        }

        if (! MessengerCookies::hasRequired($cookies, 'c_user', 'xs')) {
            throw ValidationException::withMessages(['cookies' => 'Thiếu cookie bắt buộc: c_user, xs.']);
        }

        return $cookies;
    }

    /** @param array<string, string> $cookies */
    private function signIn(array $cookies): JsonResponse
    {
        try {
            // * Other accounts stay signed in. Only a login of the SAME Facebook account (`c_user`) is replaced, so a
            // * re-login with fresh cookies never leaves two logins for one account.
            $facebookId = $cookies['c_user'] ?? null;

            foreach ($this->bridge->logins() as $login) {
                if ($login['id'] === $facebookId || $login['remote_id'] === $facebookId) {
                    $this->bridge->logout($login['id']);
                }
            }

            $step = $this->bridge->start(self::FLOW_ID);
        } catch (ConnectionException) {
            return $this->unavailable(503, MessengerChannel::BRIDGE_DOWN);
        } catch (MatrixException) {
            return $this->unavailable(502, self::BRIDGE_ERROR);
        }

        return $this->driveStep($step, $cookies);
    }

    /**
     * @param  LoginStep  $step
     * @param  array<string, string>  $cookies
     */
    private function driveStep(array $step, array $cookies): JsonResponse
    {
        $deadline = now()->addSeconds(self::DISPLAY_AND_WAIT_BUDGET_SECONDS);

        while (true) {
            if ($step['type'] === 'complete') {
                return $this->complete($step);
            }

            if ($step['type'] === 'cookies') {
                $response = $this->submitCookies($step, $cookies);

                if ($response !== null) {
                    return $response;
                }
            } elseif ($step['type'] === 'display_and_wait') {
                if (now()->greaterThanOrEqualTo($deadline)) {
                    return $this->cancelAndFail($step['process_id'], 'Messenger bridge chờ quá lâu, hãy thử lại.');
                }
            } elseif ($step['type'] === 'user_input') {
                return $this->cancelAndFail($step['process_id'], 'Facebook yêu cầu xác minh thêm. Hãy mở facebook.com trên trình duyệt, hoàn tất xác minh rồi dán lại cookie mới.');
            } else {
                // * `webauthn`, `client_http` or any step type this app does not drive.
                return $this->cancelAndFail($step['process_id'], self::UNSUPPORTED_STEP);
            }

            try {
                $step = $this->bridge->step($step['process_id'], $step['step_id'], $step['type'], $step['type'] === 'cookies' ? $this->cookiePayload($step, $cookies) : []);
            } catch (ConnectionException) {
                return $this->unavailable(503, MessengerChannel::BRIDGE_DOWN);
            } catch (MatrixException $exception) {
                return $this->stepFailed($step['process_id'], $exception);
            }
        }
    }

    /**
     * Returns a response only when the cookie step cannot proceed (a bridge-required cookie is missing); otherwise
     * null so the caller submits the step.
     *
     * @param  LoginStep  $step
     * @param  array<string, string>  $cookies
     */
    private function submitCookies(array $step, array $cookies): ?JsonResponse
    {
        $missing = [];

        foreach ($step['fields'] as $field) {
            if ($field['required'] && ($cookies[$field['id']] ?? '') === '') {
                $missing[] = $field['id'];
            }
        }

        return $missing === [] ? null : $this->cancelAndFail($step['process_id'], 'Thiếu cookie bắt buộc: '.implode(', ', $missing).'.');
    }

    /**
     * Only the cookie names the bridge itself declared for this step are sent on; nothing else from the pasted
     * string ever reaches the bridge.
     *
     * @param  LoginStep  $step
     * @param  array<string, string>  $cookies
     * @return array<string, string>
     */
    private function cookiePayload(array $step, array $cookies): array
    {
        $allowedIds = array_column($step['fields'], 'id');

        return array_intersect_key($cookies, array_flip($allowedIds));
    }

    private function stepFailed(string $processId, MatrixException $exception): JsonResponse
    {
        $this->cancelBestEffort($processId);

        return $exception->isAmbiguous() ? $this->unavailable(502, self::BRIDGE_ERROR) : $this->unavailable(422, self::COOKIE_REJECTED);
    }

    private function cancelAndFail(string $processId, string $message): JsonResponse
    {
        $this->cancelBestEffort($processId);

        return $this->unavailable(422, $message);
    }

    private function cancelBestEffort(string $processId): void
    {
        try {
            $this->bridge->cancel($processId);
        } catch (ConnectionException|MatrixException) {
            // * Best effort: a process that already finished or a bridge that died has nothing left to cancel.
        }
    }

    /** @param LoginStep $step */
    private function complete(array $step): JsonResponse
    {
        $complete = $step['complete'];
        $loginId = $complete['login_id'] ?? null;

        if (! is_string($loginId) || $loginId === '') {
            return $this->unavailable(502, self::BRIDGE_ERROR);
        }

        $integration = Integration::query()->where('provider', MessengerChannel::PROVIDER)->first()
            ?? new Integration(['provider' => MessengerChannel::PROVIDER]);

        $settings = $integration->settings ?? [];
        $settings['fields'] ??= [];
        // * A new integration starts with the default scopes, otherwise the page would show every scope unticked.
        $settings['permissions'] ??= collect($this->integrations->definition(MessengerChannel::PROVIDER)['permissions'] ?? [])
            ->filter(fn (array $permission): bool => (bool) $permission['default'])
            ->pluck('key')
            ->all();
        $settings['risk_acknowledged'] = true;

        $integration->forceFill([
            'status' => Integration::STATUS_CONNECTED,
            'last_error' => null,
            'last_checked_at' => now(),
            'credentials' => null,
            'settings' => $settings,
        ])->save();

        $accountName = $complete['name'];
        $remoteId = $complete['remote_id'];

        // * One row per bridge login: signing the same account in again updates it, any other account is left alone.
        $account = MessengerAccount::query()->updateOrCreate(
            ['login_id' => $loginId],
            [
                'integration_id' => $integration->id,
                'remote_id' => is_string($remoteId) && $remoteId !== '' ? $remoteId : $loginId,
                'name' => $accountName ?? MessengerAccount::query()->where('login_id', $loginId)->value('name'),
                'status' => Integration::STATUS_CONNECTED,
                'last_error' => null,
                'bridge_state' => 'CONNECTED',
                'bridge_state_at' => now(),
                'connected_at' => now(),
                ...($this->requestedPermissions === null ? [] : ['permissions' => $this->requestedPermissions]),
            ],
        );

        return response()->json(['status' => 'connected', 'account_name' => $account->name, 'account_id' => $account->id])->header('Cache-Control', 'no-store');
    }

    private function unavailable(int $status, string $message): JsonResponse
    {
        return response()->json(['message' => $message], $status)->header('Cache-Control', 'no-store');
    }
}
