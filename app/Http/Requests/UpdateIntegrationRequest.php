<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\Integration;
use App\Services\Integrations\IntegrationManager;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** * Validates against the provider definition in `config/integrations.php`: only declared fields, secrets and scopes are accepted. */
class UpdateIntegrationRequest extends FormRequest
{
    // * Permission is enforced by the `AuthorizeResource` route middleware.
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $definition = $this->definition();
        $storedSecrets = Integration::query()->where('provider', $this->route('provider'))->first()->credentials ?? [];
        $rules = [];

        foreach ($definition['fields'] as $field) {
            $key = $field['key'];
            $required = $field['required'] ?? false;

            if ($field['type'] === 'secret') {
                // * Leaving a stored secret blank keeps it; it is only mandatory while none is stored.
                $mandatory = $required && blank($storedSecrets[$key] ?? null);
                $rules["secrets.{$key}"] = [$mandatory ? 'required' : 'nullable', 'string', 'max:'.($field['max'] ?? 1000)];

                if (isset($field['pattern'])) {
                    $rules["secrets.{$key}"][] = 'regex:'.$field['pattern'];
                }

                continue;
            }

            $rules["fields.{$key}"] = match (true) {
                $field['type'] === 'select' => [$required ? 'required' : 'nullable', Rule::in(array_keys($field['options']))],
                default => [$required ? 'required' : 'nullable', 'string', 'max:255', ...(($field['format'] ?? null) === 'email' ? ['email'] : [])],
            };
        }

        $rules['permissions'] = ['nullable', 'array'];
        $rules['permissions.*'] = ['string', 'distinct', Rule::in(array_column($definition['permissions'], 'key'))];
        $rules['risk_acknowledged'] = $this->requiresRiskAcknowledgement() ? ['accepted'] : ['nullable', 'boolean'];

        return $rules;
    }

    /** @return array<string, string> */
    public function attributes(): array
    {
        $attributes = ['risk_acknowledged' => 'xác nhận rủi ro', 'permissions' => 'quyền và phạm vi'];

        foreach ($this->definition()['fields'] as $field) {
            $prefix = $field['type'] === 'secret' ? 'secrets' : 'fields';
            $attributes["{$prefix}.{$field['key']}"] = mb_strtolower($field['label']);
        }

        return $attributes;
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['risk_acknowledged.accepted' => 'Bạn cần xác nhận đã hiểu rủi ro trước khi lưu kết nối không chính thức.'];
    }

    /**
     * Allowlisted, normalized input for `IntegrationProvider::connect()`; secrets are only the non-blank ones submitted.
     *
     * @return array{fields: array<string, ?string>, secrets: array<string, string>, permissions: list<string>, risk_acknowledged: bool}
     */
    public function connectionInput(): array
    {
        $validated = $this->validated();
        $fields = [];
        $secrets = [];

        foreach ($this->definition()['fields'] as $field) {
            $key = $field['key'];

            if ($field['type'] === 'secret') {
                $secret = $validated['secrets'][$key] ?? null;

                if (filled($secret)) {
                    $secrets[$key] = $secret;
                }

                continue;
            }

            $fields[$key] = $validated['fields'][$key] ?? null;
        }

        return [
            'fields' => $fields,
            'secrets' => $secrets,
            'permissions' => array_values($validated['permissions'] ?? []),
            'risk_acknowledged' => (bool) ($validated['risk_acknowledged'] ?? false),
        ];
    }

    /** * A personal-account connection: the provider itself, a ticked scope or a filled field is flagged `unofficial`. */
    private function requiresRiskAcknowledgement(): bool
    {
        $definition = $this->definition();

        if ($definition['unofficial'] ?? false) {
            return true;
        }

        $selected = (array) $this->input('permissions', []);

        foreach ($definition['permissions'] as $permission) {
            if (($permission['unofficial'] ?? false) && in_array($permission['key'], $selected, true)) {
                return true;
            }
        }

        foreach ($definition['fields'] as $field) {
            $prefix = $field['type'] === 'secret' ? 'secrets' : 'fields';

            if (($field['unofficial'] ?? false) && filled($this->input("{$prefix}.{$field['key']}"))) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    private function definition(): array
    {
        return app(IntegrationManager::class)->definition((string) $this->route('provider')) ?? abort(404);
    }
}
