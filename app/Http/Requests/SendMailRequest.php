<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * * Reply form. `client_token` is generated in the browser so one click sends exactly once. Addresses must be RFC-valid and the
 * * subject may not contain a line break, which keeps header injection out (plain text only, no attachments).
 */
class SendMailRequest extends FormRequest
{
    public const MAX_RECIPIENTS = 20;

    // * Permission is enforced by the `AuthorizeResource` route middleware (`mail.send`).
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'to' => ['required', 'array', 'min:1', 'max:'.self::MAX_RECIPIENTS],
            'to.*' => ['required', 'string', 'email:rfc', 'max:255'],
            'cc' => ['nullable', 'array', 'max:'.self::MAX_RECIPIENTS],
            'cc.*' => ['required', 'string', 'email:rfc', 'max:255'],
            'subject' => ['required', 'string', 'max:255', 'regex:/^[^\r\n]*$/'],
            'body' => ['required', 'string', 'max:100000'],
            'client_token' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'quote_original' => ['nullable', 'boolean'],
        ];
    }

    /** @return array<string, string> */
    public function attributes(): array
    {
        return ['to' => 'người nhận', 'cc' => 'người nhận bản sao', 'subject' => 'tiêu đề', 'body' => 'nội dung'];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['subject.regex' => 'Tiêu đề không được xuống dòng.'];
    }

    /** @return list<Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if (count((array) $this->input('to')) + count((array) $this->input('cc')) > self::MAX_RECIPIENTS) {
                $validator->errors()->add('to', 'Tối đa '.self::MAX_RECIPIENTS.' người nhận (gồm cả bản sao).');
            }
        }];
    }

    /** @return array{to: list<string>, cc: list<string>, subject: string, body: string, client_token: string, quote_original: bool} */
    public function replyInput(): array
    {
        $validated = $this->validated();

        return [
            'to' => array_values(array_unique(array_map('strtolower', $validated['to']))),
            'cc' => array_values(array_unique(array_map('strtolower', $validated['cc'] ?? []))),
            'subject' => trim($validated['subject']),
            'body' => $validated['body'],
            'client_token' => $validated['client_token'],
            'quote_original' => (bool) ($validated['quote_original'] ?? false),
        ];
    }
}
