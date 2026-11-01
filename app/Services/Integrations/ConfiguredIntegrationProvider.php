<?php

declare(strict_types=1);

namespace App\Services\Integrations;

use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Chat\Matrix\BridgeProvisioningClient;
use App\Services\Chat\Matrix\MatrixException;
use App\Services\Chat\Messenger\MessengerChannel;
use App\Services\Chat\Zalo\ZaloBridgeClient;
use App\Services\Chat\Zalo\ZaloBridgeException;
use App\Services\Chat\Zalo\ZaloChannel;
use App\Services\Posting\FacebookBrowserScript;
use App\Services\Posting\FacebookPersonalPublisher;
use App\Services\Posting\FacebookWebSession;
use App\Services\Posting\LinkedInBrowserScript;
use App\Services\Posting\LinkedInPersonalPublisher;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/** * Generic provider driven by one `config/integrations.php` entry. Only the `telegram`, `zalo`, `facebook`, `matrix_bridge` and `ai` test strategies perform a real check. */
class ConfiguredIntegrationProvider implements IntegrationProvider
{
    /** @param array<string, mixed> $definition */
    public function __construct(
        private readonly string $key,
        private readonly array $definition,
    ) {}

    public function key(): string
    {
        return $this->key;
    }

    public function connect(array $input): Integration
    {
        $integration = $this->integration() ?? new Integration(['provider' => $this->key]);
        if (($this->definition['login'] ?? null) === 'oauth' && isset($input['secrets']['access_token'])) {
            $integration->meta = array_diff_key($integration->meta ?? [], array_flip(['expires_at', 'account_name', 'connected_via'])) ?: null;
        }

        $integration->fill([
            'credentials' => array_merge($integration->credentials ?? [], $input['secrets']) ?: null,
            'settings' => [
                'fields' => $input['fields'],
                'permissions' => $input['permissions'],
                'risk_acknowledged' => $input['risk_acknowledged'],
            ],
            'status' => $this->usesBridgeLogin() ? ($integration->status ?? Integration::STATUS_DISCONNECTED) : Integration::STATUS_CONNECTED,
            'last_error' => $this->usesBridgeLogin() ? $integration->last_error : null,
        ])->save();

        if (($this->definition['test'] ?? null) === 'facebook' && filled($integration->credentials['page_access_token'] ?? null)) {
            $this->testFacebook();
            $integration->refresh();
        }

        return $integration;
    }

    public function test(): ConnectionTestResult
    {
        return match ($this->definition['test'] ?? null) {
            'telegram' => $this->testTelegram(),
            'github' => $this->testGithub(),
            'zalo' => $this->testZalo(),
            'facebook' => $this->testFacebook(),
            'facebook_personal' => $this->testFacebookPersonal(),
            'linkedin_personal' => $this->testLinkedInPersonal(),
            'matrix_bridge' => $this->testMessenger(),
            'ai' => $this->testAi(),
            default => ConnectionTestResult::unsupported(),
        };
    }

    public function disconnect(): Integration
    {
        $integration = $this->integration() ?? new Integration(['provider' => $this->key]);

        if ($this->usesQrLogin()) {
            $this->logoutZalo($integration);
        } elseif ($this->usesMatrixBridgeLogin()) {
            $this->logoutMessenger($integration);
        }

        $integration->fill([
            'credentials' => null,
            'meta' => null,
            'status' => Integration::STATUS_DISCONNECTED,
            'last_error' => null,
        ])->save();

        return $integration;
    }

    public function status(): string
    {
        return $this->integration()->status ?? Integration::STATUS_DISCONNECTED;
    }

    private function usesQrLogin(): bool
    {
        return ($this->definition['login'] ?? null) === 'qr';
    }

    private function usesMatrixBridgeLogin(): bool
    {
        return ($this->definition['login'] ?? null) === 'matrix_bridge';
    }

    /** * A login the bridge itself manages (QR or Matrix cookie): saving the form must never set `connected` on its own. */
    private function usesBridgeLogin(): bool
    {
        return $this->usesQrLogin() || $this->usesMatrixBridgeLogin();
    }

    // * Best effort, like Messenger: every account is signed out on the sidecar, its stored session is removed and it is marked disconnected; conversations stay.
    private function logoutZalo(Integration $integration): void
    {
        foreach (app(ZaloChannel::class)->accounts($integration) as $account) {
            try {
                app(ZaloBridgeClient::class)->logout($account->account_key);
            } catch (ConnectionException|ZaloBridgeException) {
                // * Disconnecting must work while the sidecar is down: the stored session is removed either way.
            }

            $account->forceFill(['credentials' => null, 'status' => Integration::STATUS_DISCONNECTED, 'last_error' => null, 'bridge_state' => null, 'bridge_state_at' => now()])->save();
        }
    }

    // * Best effort: a bridge that is down or has already forgotten a login leaves nothing to log out. Every account is logged out and marked disconnected; conversations stay.
    private function logoutMessenger(Integration $integration): void
    {
        $channel = app(MessengerChannel::class);
        $bridge = app(BridgeProvisioningClient::class);

        foreach ($channel->accounts($integration) as $account) {
            try {
                $bridge->logout($account->login_id);
            } catch (ConnectionException|MatrixException) {
                // * Disconnecting must work while the bridge is down: the stored login is marked disconnected either way.
            }

            $account->forceFill(['status' => Integration::STATUS_DISCONNECTED, 'last_error' => null, 'bridge_state' => null, 'bridge_state_at' => now()])->save();
        }
    }

    private function integration(): ?Integration
    {
        return Integration::query()->where('provider', $this->key)->first();
    }

    // ! The token sits in the request URL: never log it, and never surface the exception (its message contains the URL).
    private function testGithub(): ConnectionTestResult
    {
        $integration = $this->integration();
        $token = $integration?->credentials['token'] ?? null;

        if ($integration === null || blank($token)) {
            return ConnectionTestResult::failed('Chưa lưu Personal Access Token.');
        }

        try {
            $response = Http::timeout(5)->connectTimeout(3)->withToken($token)->withHeaders(['Accept' => 'application/vnd.github+json', 'X-GitHub-Api-Version' => '2022-11-28'])->get('https://api.github.com/user');
        } catch (ConnectionException) {
            return $this->recordTest($integration, ConnectionTestResult::failed('Không kết nối được tới GitHub.'));
        }

        if ($response->successful()) {
            $login = $response->json('login');
            $integration->meta = array_merge($integration->meta ?? [], ['login' => is_string($login) ? $login : null]);

            return $this->recordTest($integration, ConnectionTestResult::passed(is_string($login) ? "Kết nối thành công ({$login})." : 'Kết nối thành công.'));
        }

        $message = $response->status() === 401
            ? 'Token không hợp lệ hoặc đã bị thu hồi.'
            : "GitHub trả về lỗi (HTTP {$response->status()}).";

        return $this->recordTest($integration, ConnectionTestResult::failed($message));
    }

    private function testTelegram(): ConnectionTestResult
    {
        $integration = $this->integration();
        $token = $integration?->credentials['bot_token'] ?? null;

        if ($integration === null || blank($token)) {
            return ConnectionTestResult::failed('Chưa lưu Bot token.');
        }

        try {
            $response = Http::timeout(5)
                ->connectTimeout(3)
                ->acceptJson()
                ->get("https://api.telegram.org/bot{$token}/getMe");
        } catch (ConnectionException) {
            return $this->recordTest($integration, ConnectionTestResult::failed('Không kết nối được tới Telegram.'));
        }

        if ($response->successful() && $response->json('ok') === true) {
            $username = $response->json('result.username');
            // * Merge: `meta` also holds the chat poll offset, which a connection test must not reset.
            $integration->meta = array_merge($integration->meta ?? [], ['bot_username' => is_string($username) ? $username : null]);

            return $this->recordTest(
                $integration,
                ConnectionTestResult::passed(is_string($username) ? "Kết nối thành công (@{$username})." : 'Kết nối thành công.'),
            );
        }

        $message = $response->status() === 401
            ? 'Bot token không hợp lệ hoặc đã bị thu hồi.'
            : "Telegram trả về lỗi (HTTP {$response->status()}).";

        return $this->recordTest($integration, ConnectionTestResult::failed($message));
    }

    // * Runs `session` of scripts/facebook-post.mjs on this machine (opens Chrome, never posts; refreshes the saved session). Fixed messages only.
    private function testFacebookPersonal(): ConnectionTestResult
    {
        $integration = $this->integration();

        if ($integration === null) {
            return ConnectionTestResult::failed('Chưa lưu kết nối Facebook cá nhân.');
        }

        // * `session` checks the login and refreshes the saved session file in one launch.
        $outcome = (new FacebookBrowserScript)->run('session');
        $payload = $outcome['payload'];

        if ($outcome['status'] === 'ok' && ($payload['loggedIn'] ?? false) === true) {
            // * One cheap local check, no request to Facebook: is the refreshed session complete enough for the HTTP tier?
            $note = (new FacebookWebSession)->load() !== null
                ? 'Bài văn bản sẽ đăng bằng request HTTP từ máy chủ.'
                : 'Chưa có mẫu request, bài văn bản đầu tiên sẽ đăng bằng trình duyệt và ghi nhớ mẫu.';

            return $this->recordTest($integration, ConnectionTestResult::passed('Đã đăng nhập Facebook trên máy này. '.$note));
        }

        $message = match (true) {
            $outcome['status'] === 'no_node' => 'Không chạy được Node trên máy này.',
            $outcome['status'] === 'timed_out' => 'Hết thời gian chờ Chrome, hãy thử lại.',
            ($payload['error'] ?? null) === 'browser_unavailable' => 'Không mở được Chrome (chưa cài Chrome hoặc hồ sơ đang mở ở cửa sổ khác).',
            ($payload['error'] ?? null) === 'checkpoint' => 'Facebook yêu cầu xác minh, hãy xử lý trong cửa sổ Chrome.',
            $outcome['status'] === 'ok' => FacebookPersonalPublisher::NOT_LOGGED_IN,
            default => 'Không kiểm tra được kết nối Facebook cá nhân.',
        };

        return $this->recordTest($integration, ConnectionTestResult::failed($message));
    }

    // * Runs `session` of scripts/linkedin-post.mjs on this machine (opens Chrome, never posts). Fixed messages only.
    private function testLinkedInPersonal(): ConnectionTestResult
    {
        $integration = $this->integration();

        if ($integration === null) {
            return ConnectionTestResult::failed('Chưa lưu kết nối LinkedIn cá nhân.');
        }

        $outcome = (new LinkedInBrowserScript)->run('session');
        $payload = $outcome['payload'];

        if ($outcome['status'] === 'ok' && ($payload['loggedIn'] ?? false) === true) {
            $note = ($payload['template'] ?? false) === true
                ? 'Bài văn bản sẽ đăng bằng request trong Chrome.'
                : 'Chưa có mẫu request, bài văn bản đầu tiên sẽ đăng bằng giao diện Chrome và ghi nhớ mẫu.';

            return $this->recordTest($integration, ConnectionTestResult::passed('Đã đăng nhập LinkedIn trên máy này. '.$note));
        }

        $message = match (true) {
            $outcome['status'] === 'no_node' => 'Không chạy được Node trên máy này.',
            $outcome['status'] === 'timed_out' => 'Hết thời gian chờ Chrome, hãy thử lại.',
            ($payload['error'] ?? null) === 'browser_unavailable' => 'Không mở được Chrome (chưa cài Chrome hoặc hồ sơ đang mở ở cửa sổ khác).',
            ($payload['error'] ?? null) === 'checkpoint' => 'LinkedIn yêu cầu xác minh, hãy xử lý trong cửa sổ Chrome.',
            $outcome['status'] === 'ok' => LinkedInPersonalPublisher::NOT_LOGGED_IN,
            default => 'Không kiểm tra được kết nối LinkedIn cá nhân.',
        };

        return $this->recordTest($integration, ConnectionTestResult::failed($message));
    }

    // ! The token sits in the request URL: never log it, and never surface the exception (its message contains the URL).
    private function testFacebook(): ConnectionTestResult
    {
        $integration = $this->integration();
        $token = $integration?->credentials['page_access_token'] ?? null;

        if ($integration === null || blank($token)) {
            return ConnectionTestResult::failed('Chưa lưu Page access token.');
        }

        try {
            $response = Http::timeout(5)
                ->connectTimeout(3)
                ->acceptJson()
                ->get('https://graph.facebook.com/'.config('posting.graph_version').'/me', ['fields' => 'id,name', 'access_token' => $token]);
        } catch (ConnectionException) {
            return $this->recordTest($integration, ConnectionTestResult::failed('Không kết nối được tới Facebook.'));
        }

        if ($response->successful() && filled($response->json('id'))) {
            $name = $response->json('name');
            $name = is_string($name) ? $name : null;
            $settings = $integration->settings ?? [];

            // * Only blanks are filled: a value the user typed is never overwritten.
            if (blank($settings['fields']['page_id'] ?? null)) {
                $settings['fields']['page_id'] = (string) $response->json('id');
            }

            if ($name !== null && blank($settings['fields']['fanpage'] ?? null)) {
                $settings['fields']['fanpage'] = $name;
            }

            $integration->settings = $settings;

            return $this->recordTest($integration, ConnectionTestResult::passed($name !== null ? "Kết nối thành công ({$name})." : 'Kết nối thành công.'));
        }

        $message = in_array($response->status(), [400, 401], true)
            ? 'Page access token không hợp lệ hoặc đã hết hạn.'
            : "Facebook trả về lỗi (HTTP {$response->status()}).";

        return $this->recordTest($integration, ConnectionTestResult::failed($message));
    }

    // ! The health answer carries no credentials; only fixed texts reach the user. Checks every account against its own session.
    private function testZalo(): ConnectionTestResult
    {
        $integration = $this->integration();
        $channel = app(ZaloChannel::class);
        $accounts = $integration === null ? collect() : $channel->accounts($integration)->filter(fn (ZaloAccount $account): bool => $channel->credentials($account) !== null);

        try {
            app(ZaloBridgeClient::class)->health();
        } catch (ConnectionException|ZaloBridgeException) {
            return ConnectionTestResult::failed('Zalo bridge không chạy.');
        }

        if ($accounts->isEmpty()) {
            return ConnectionTestResult::failed('Chưa đăng nhập Zalo, hãy quét mã QR.');
        }

        $running = 0;

        foreach ($accounts as $account) {
            try {
                $state = app(ZaloBridgeClient::class)->health($account->account_key)['state'];
            } catch (ConnectionException|ZaloBridgeException) {
                return ConnectionTestResult::failed('Zalo bridge không chạy.');
            }

            $channel->markAccountState($account, $state);
            $running += $state === 'running' ? 1 : 0;
        }

        return $running === $accounts->count()
            ? ConnectionTestResult::passed("Kết nối thành công ({$running} tài khoản).")
            : ConnectionTestResult::failed('Một số tài khoản Zalo chưa đăng nhập hoặc đang kết nối lại.');
    }

    // ! `logins()` carries no cookies; only fixed texts and the bridge's own `name` reach the user.
    private function testMessenger(): ConnectionTestResult
    {
        $channel = app(MessengerChannel::class);

        if (! $channel->configured()) {
            return ConnectionTestResult::failed(MessengerChannel::NOT_CONFIGURED);
        }

        $integration = $this->integration();
        $accounts = $integration === null ? collect() : $channel->accounts($integration)->where('status', '!=', Integration::STATUS_DISCONNECTED);

        if ($integration === null || $accounts->isEmpty()) {
            return ConnectionTestResult::failed('Chưa đăng nhập Messenger, hãy dán cookie để đăng nhập.');
        }

        try {
            $logins = collect(app(BridgeProvisioningClient::class)->logins());
        } catch (ConnectionException|MatrixException) {
            $integration->forceFill([
                'status' => Integration::STATUS_ERROR,
                'last_error' => MessengerChannel::BRIDGE_DOWN,
                'last_checked_at' => now(),
            ])->save();

            return ConnectionTestResult::failed(MessengerChannel::BRIDGE_DOWN);
        }

        foreach ($accounts as $account) {
            $match = $logins->firstWhere('id', $account->login_id);
            $channel->markAccountState($account, $match['state'] ?? null, $match['name'] ?? null);
        }

        $integration->refresh();
        $connected = $channel->accounts($integration)->where('status', Integration::STATUS_CONNECTED)->pluck('name')->filter()->values();

        if ($integration->status === Integration::STATUS_CONNECTED) {
            return ConnectionTestResult::passed($connected->isEmpty() ? 'Kết nối thành công.' : 'Kết nối thành công ('.$connected->implode(', ').').');
        }

        return ConnectionTestResult::failed((string) $integration->last_error);
    }

    // ! One short real call through the enabled AI accounts (fallback applies). `AiException` carries fixed texts only (never a token, URL or vendor body).
    // * Each account keeps its own status; the integration row only mirrors the overall result.
    private function testAi(): ConnectionTestResult
    {
        $integration = $this->integration() ?? new Integration(['provider' => $this->key]);

        try {
            app(AiAssistant::class)->complete(null, 'Trả lời đúng một từ.', 'Trả lời: OK');
        } catch (AiException $exception) {
            return $this->recordTest($integration, ConnectionTestResult::failed($exception->getMessage()));
        }

        return $this->recordTest($integration, ConnectionTestResult::passed('Kết nối thành công.'));
    }

    private function recordTest(Integration $integration, ConnectionTestResult $result): ConnectionTestResult
    {
        $integration->forceFill([
            'status' => $result->ok ? Integration::STATUS_CONNECTED : Integration::STATUS_ERROR,
            'last_error' => $result->ok ? null : $result->message,
            'last_checked_at' => now(),
        ])->save();

        return $result;
    }
}
