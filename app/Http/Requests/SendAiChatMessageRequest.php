<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Services\Ai\AiAssistant;
use App\Services\Ai\ChatAttachmentReader;
use App\Services\Ai\ChatImages;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** * One message of the home AI chat. Permission is enforced by the `AuthorizeResource` route middleware (`ai.use`); ownership of `conversation_id` by the controller (404). */
class SendAiChatMessageRequest extends FormRequest
{
    public const MAX_MESSAGE_LENGTH = 2000;

    public const MAX_ATTACHMENTS = 5;

    /** Read-only repos / local folders that may join the chosen project in one message. */
    public const MAX_EXTRA_SOURCES = 3;

    public const MAX_ATTACHMENT_KB = 5120;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'message' => ['required', 'string', 'max:'.self::MAX_MESSAGE_LENGTH],
            'conversation_id' => ['nullable', 'uuid'],
            'ai_account_id' => ['nullable', 'integer'],
            'ai_model' => ['nullable', 'string', 'max:100'],
            'mode' => ['nullable', Rule::in([AiAssistant::MODE_AUTO, AiAssistant::MODE_PLAN])],
            'auto_pr' => ['nullable', 'boolean'],
            'local_root' => ['nullable', 'string', 'regex:/^[a-z0-9_-]{1,40}$/', 'prohibits:repo'],
            'repo' => ['nullable', 'string', 'max:140', 'regex:#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#'],
            'extra_repos' => ['nullable', 'array', 'max:'.self::MAX_EXTRA_SOURCES],
            'extra_repos.*' => ['string', 'max:140', 'regex:#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', 'distinct'],
            'extra_local_roots' => ['nullable', 'array', 'max:'.self::MAX_EXTRA_SOURCES],
            'extra_local_roots.*' => ['string', 'regex:/^[a-z0-9_-]{1,40}$/', 'distinct'],
            'attachments' => ['nullable', 'array', 'max:'.self::MAX_ATTACHMENTS],
            'attachments.*' => ['file', 'max:'.self::MAX_ATTACHMENT_KB, 'extensions:'.implode(',', [...ChatAttachmentReader::extensions(), ...ChatImages::EXTENSIONS])],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'message.required' => 'Hãy nhập nội dung tin nhắn.',
            'attachments.max' => 'Tối đa '.self::MAX_ATTACHMENTS.' tệp mỗi tin nhắn.',
            'attachments.*.max' => 'Mỗi tệp tối đa '.(self::MAX_ATTACHMENT_KB / 1024).' MB.',
            'attachments.*.extensions' => 'Loại tệp này chưa được hỗ trợ.',
            'repo.regex' => 'Tên repo không hợp lệ.',
            'message.max' => 'Tin nhắn tối đa '.self::MAX_MESSAGE_LENGTH.' ký tự.',
        ];
    }
}
