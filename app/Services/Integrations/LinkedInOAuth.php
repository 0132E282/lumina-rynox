<?php

declare(strict_types=1);

namespace App\Services\Integrations;

use App\Models\Integration;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * LinkedIn OAuth 2.0 authorization-code flow for a personal account (endpoints/scopes in `config/services.php`, unverified against current docs).
 * ! Code, token and secret never reach logs, flashes or Inertia props, and HTTP exceptions are never surfaced (their message holds URL/body).
 */
final class LinkedInOAuth
{
    public const PROVIDER = 'linkedin';

    /** Token validity (seconds) assumed when LinkedIn omits `expires_in`; LinkedIn member tokens usually last 60 days. */
    private const DEFAULT_EXPIRES_IN = 5_184_000;

    public function isConfigured(): bool
    {
        return filled(config('services.linkedin.client_id')) && filled(config('services.linkedin.client_secret'));
    }

    public function redirectUri(): string
    {
        return config('services.linkedin.redirect') ?: route('integrations.linkedin.oauth.callback');
    }

    public function authorizationUrl(string $state): string
    {
        return config('services.linkedin.authorize_url').'?'.http_build_query([
            'response_type' => 'code',
            'client_id' => config('services.linkedin.client_id'),
            'redirect_uri' => $this->redirectUri(),
            'state' => $state,
            'scope' => implode(' ', (array) config('services.linkedin.scopes')),
        ], '', '&', PHP_QUERY_RFC3986);
    }

    /**
     * Exchanges the code, reads the profile and stores the connection.
     *
     * @throws LinkedInOAuthException with a fixed, user-safe message
     */
    public function connect(string $code): Integration
    {
        try {
            $token = $this->http()->asForm()->post((string) config('services.linkedin.token_url'), [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => $this->redirectUri(),
                'client_id' => config('services.linkedin.client_id'),
                'client_secret' => config('services.linkedin.client_secret'),
            ]);

            $accessToken = $token->successful() ? $token->json('access_token') : null;

            if (! is_string($accessToken) || $accessToken === '') {
                throw new LinkedInOAuthException('LinkedIn từ chối mã đăng nhập, hãy thử đăng nhập lại.');
            }

            $profile = $this->http()->withToken($accessToken)->get((string) config('services.linkedin.userinfo_url'));
        } catch (ConnectionException) {
            throw new LinkedInOAuthException('Không kết nối được tới LinkedIn, hãy thử lại.');
        }

        $subject = $profile->successful() ? $profile->json('sub') : null;

        if (! is_string($subject) || $subject === '') {
            throw new LinkedInOAuthException('Không đọc được hồ sơ LinkedIn, hãy kiểm tra sản phẩm "Sign In with LinkedIn using OpenID Connect".');
        }

        $name = $profile->json('name');
        $expiresIn = $token->json('expires_in');

        return $this->store(
            $accessToken,
            'urn:li:person:'.$subject,
            is_string($name) && $name !== '' ? $name : null,
            now()->addSeconds(is_numeric($expiresIn) && (int) $expiresIn > 0 ? (int) $expiresIn : self::DEFAULT_EXPIRES_IN),
        );
    }

    // * `LinkedInPublisher` reads `access_token` from credentials and `author_urn` from `settings.fields`, so it is stored there; saved permissions are kept.
    private function store(string $accessToken, string $authorUrn, ?string $name, \DateTimeInterface $expiresAt): Integration
    {
        $integration = Integration::query()->where('provider', self::PROVIDER)->first() ?? new Integration(['provider' => self::PROVIDER]);
        $settings = $integration->settings ?? [];
        $fields = array_merge($settings['fields'] ?? [], ['author_urn' => $authorUrn]);

        if ($name !== null) {
            $fields['account'] = $name;
        }

        $defaults = collect((array) config('integrations.providers.linkedin.permissions'))
            ->where('default', true)->pluck('key')->values()->all();

        $integration->fill([
            'credentials' => array_merge($integration->credentials ?? [], ['access_token' => $accessToken]),
            'settings' => array_merge($settings, [
                'fields' => $fields,
                'permissions' => $settings['permissions'] ?? $defaults,
                'risk_acknowledged' => $settings['risk_acknowledged'] ?? false,
            ]),
            'meta' => array_merge($integration->meta ?? [], [
                'expires_at' => $expiresAt->format(DATE_ATOM),
                'account_name' => $name,
                'connected_via' => 'oauth',
            ]),
            'status' => Integration::STATUS_CONNECTED,
            'last_error' => null,
            'last_checked_at' => now(),
        ])->save();

        return $integration;
    }

    private function http(): PendingRequest
    {
        return Http::timeout((int) config('services.linkedin.timeout_seconds'))
            ->connectTimeout((int) config('services.linkedin.connect_timeout_seconds'))
            ->acceptJson();
    }
}
