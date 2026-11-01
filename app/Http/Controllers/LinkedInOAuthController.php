<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Integrations\LinkedInOAuth;
use App\Services\Integrations\LinkedInOAuthException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

// ! Never log, flash or return the `code`, token or client secret; user-facing messages are fixed texts.
class LinkedInOAuthController extends Controller
{
    private const STATE_KEY = 'linkedin_oauth_state';

    public function __construct(private readonly LinkedInOAuth $oauth) {}

    public function start(Request $request): Response
    {
        if (! $this->oauth->isConfigured()) {
            return $this->back('error', 'Chưa cấu hình LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET.');
        }

        $state = Str::random(40);
        $request->session()->put(self::STATE_KEY, $state);

        return Inertia::location($this->oauth->authorizationUrl($state));
    }

    public function callback(Request $request): RedirectResponse
    {
        // * Pulled first so a state can never be replayed, whatever the outcome.
        $expected = $request->session()->pull(self::STATE_KEY);
        $state = $request->query('state');

        if (! is_string($expected) || ! is_string($state) || ! hash_equals($expected, $state)) {
            return $this->back('error', 'Phiên đăng nhập LinkedIn không hợp lệ hoặc đã hết hạn, hãy thử lại.');
        }

        if ($request->query->has('error')) {
            return $this->back('error', 'Bạn đã huỷ đăng nhập LinkedIn hoặc LinkedIn từ chối cấp quyền.');
        }

        $code = $request->query('code');

        if (! is_string($code) || $code === '' || ! $this->oauth->isConfigured()) {
            return $this->back('error', 'LinkedIn không trả về mã đăng nhập, hãy thử lại.');
        }

        try {
            $this->oauth->connect($code);
        } catch (LinkedInOAuthException $failure) {
            return $this->back('error', $failure->getMessage());
        }

        return $this->back('success', 'Đã đăng nhập LinkedIn.');
    }

    private function back(string $type, string $message): RedirectResponse
    {
        Inertia::flash('toast', ['type' => $type, 'message' => $message]);

        return to_route('integrations.show', ['provider' => LinkedInOAuth::PROVIDER]);
    }
}
