<?php

declare(strict_types=1);

namespace App\Services\Chat\Matrix;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Provisioning API (bridgev2) client for mautrix-meta (`services.mautrix_meta`): starts/drives the cookie sign-in
 * flow and reads/ends logins. The endpoint paths (`/_matrix/provision/v3/...`) come from the bridgev2 Provisioning
 * API; the exact JSON shape of each step response is UNVERIFIED against a running bridge (see
 * docs/design/messenger-personal-mautrix.md, assumption A6) because this client is built without installing or
 * running mautrix-meta. Every read here is defensive and depends on the fewest keys possible; a response that does
 * not match becomes a fixed `MatrixException(502)` rather than a crash or a leaked body.
 *
 * @phpstan-type LoginSummary array{id: string, state: ?string, name: ?string, remote_id: ?string}
 * @phpstan-type LoginStep array{process_id: string, step_id: string, type: string, fields: list<array{id: string, required: bool}>, complete: array{login_id: ?string, name: ?string, remote_id: ?string}|null}
 */
final class BridgeProvisioningClient
{
    private const CONNECT_TIMEOUT_SECONDS = 1;

    private const LOGINS_TIMEOUT_SECONDS = 2;

    private const START_TIMEOUT_SECONDS = 15;

    private const STEP_TIMEOUT_SECONDS = 30;

    private const CANCEL_TIMEOUT_SECONDS = 5;

    private const LOGOUT_TIMEOUT_SECONDS = 5;

    /**
     * @return list<LoginSummary>
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function logins(): array
    {
        // * `/whoami` lists each login with its bridge state under `state.state_event`; `/logins` only returns bare ids.
        $data = $this->call('GET', '/whoami', null, self::LOGINS_TIMEOUT_SECONDS);
        $raw = is_array($data['logins'] ?? null) ? $data['logins'] : [];
        $logins = [];

        foreach ($raw as $login) {
            $id = is_array($login) ? ($login['id'] ?? $login['login_id'] ?? null) : null;

            if (is_string($id) && $id !== '') {
                $state = $login['state']['state_event'] ?? $login['state_event'] ?? $login['state'] ?? null;

                $logins[] = [
                    'id' => $id,
                    'state' => is_string($state) ? $state : null,
                    'name' => is_string($login['name'] ?? null) ? $login['name'] : null,
                    'remote_id' => is_string($login['remote_id'] ?? null) ? $login['remote_id'] : null,
                ];
            }
        }

        return $logins;
    }

    /**
     * @return LoginStep
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function start(string $flowId): array
    {
        return $this->normalizeStep($this->call('POST', '/login/start/'.rawurlencode($flowId), [], self::START_TIMEOUT_SECONDS));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return LoginStep
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function step(string $processId, string $stepId, string $type, array $data): array
    {
        $path = '/login/step/'.rawurlencode($processId).'/'.rawurlencode($stepId).'/'.rawurlencode($type);

        return $this->normalizeStep($this->call('POST', $path, $data, self::STEP_TIMEOUT_SECONDS));
    }

    /**
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function cancel(string $processId): void
    {
        $this->call('POST', '/login/cancel/'.rawurlencode($processId), [], self::CANCEL_TIMEOUT_SECONDS, expectBody: false);
    }

    /**
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function logout(string $loginId): void
    {
        $this->call('POST', '/logout/'.rawurlencode($loginId), [], self::LOGOUT_TIMEOUT_SECONDS, expectBody: false);
    }

    /**
     * @param  array<string, mixed>  $raw
     * @return LoginStep
     */
    private function normalizeStep(array $raw): array
    {
        $processId = $raw['login_id'] ?? $raw['process_id'] ?? null;
        $stepId = $raw['step_id'] ?? null;
        $type = $raw['type'] ?? null;

        if (! is_string($processId) || $processId === '' || ! is_string($stepId) || ! is_string($type) || $type === '') {
            throw new MatrixException(502);
        }

        $stepData = is_array($raw[$type] ?? null) ? $raw[$type] : [];
        $fields = [];

        foreach (is_array($stepData['fields'] ?? null) ? $stepData['fields'] : [] as $field) {
            if (is_array($field) && is_string($field['id'] ?? null) && $field['id'] !== '') {
                $fields[] = ['id' => $field['id'], 'required' => ($field['required'] ?? false) === true];
            }
        }

        $complete = null;

        if ($type === 'complete') {
            $completeData = is_array($raw['complete'] ?? null) ? $raw['complete'] : [];
            $complete = [
                'login_id' => $this->stringAt($completeData, 'user_login_id') ?? $this->stringAt($completeData, 'login_id'),
                'name' => $this->stringAt($completeData, 'name') ?? $this->stringAt($completeData, 'user_login', 'name'),
                'remote_id' => $this->stringAt($completeData, 'remote_id') ?? $this->stringAt($completeData, 'user_login', 'remote_id'),
            ];
        }

        return ['process_id' => $processId, 'step_id' => $stepId, 'type' => $type, 'fields' => $fields, 'complete' => $complete];
    }

    /** @param array<string, mixed> $data */
    private function stringAt(array $data, string ...$path): ?string
    {
        $value = $data;

        foreach ($path as $key) {
            if (! is_array($value) || ! array_key_exists($key, $value)) {
                return null;
            }

            $value = $value[$key];
        }

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * @param  array<string, mixed>|null  $payload
     * @return array<string, mixed>
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    private function call(string $method, string $path, ?array $payload, int $timeoutSeconds, bool $expectBody = true): array
    {
        $baseUrl = (string) config('services.mautrix_meta.provisioning_url');
        $secret = (string) config('services.mautrix_meta.provisioning_secret');
        $userId = (string) config('services.matrix.user_id');

        if ($baseUrl === '' || $secret === '' || $userId === '') {
            throw MatrixException::notConfigured();
        }

        $request = Http::timeout($timeoutSeconds)->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)->acceptJson()->withToken($secret);

        if ($payload !== null) {
            $request = $request->withBody(json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'application/json');
        }

        $url = rtrim($baseUrl, '/').'/_matrix/provision/v3'.$path.'?'.http_build_query(['user_id' => $userId]);
        $response = $request->send($method, $url);

        if (! $response->successful()) {
            throw new MatrixException($response->status(), $this->errcode($response->json()));
        }

        // * `cancel`/`logout` answer with no body (e.g. 204): nothing to parse, so an empty body is not a malformed response.
        if (! $expectBody && trim($response->body()) === '') {
            return [];
        }

        $data = $response->json();

        return is_array($data) ? $data : throw new MatrixException(502);
    }

    private function errcode(mixed $data): ?string
    {
        return is_array($data) && is_string($data['errcode'] ?? null) ? $data['errcode'] : null;
    }
}
