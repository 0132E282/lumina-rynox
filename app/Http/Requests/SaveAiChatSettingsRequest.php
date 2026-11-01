<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\AiChatSetting;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** * The signed-in admin's chat customisation. Permission is `ai.use` (route middleware); the row is always the caller's own. */
class SaveAiChatSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'custom_instructions' => ['nullable', 'string', 'max:'.AiChatSetting::MAX_INSTRUCTIONS],
            'display_name' => ['nullable', 'string', 'max:'.AiChatSetting::MAX_DISPLAY_NAME],
            'assistant_name' => ['nullable', 'string', 'max:'.AiChatSetting::MAX_ASSISTANT_NAME],
            'assistant_icon' => ['nullable', 'string', Rule::in(AiChatSetting::ICONS)],
            'assistant_color' => ['nullable', 'string', Rule::in(AiChatSetting::COLORS)],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'custom_instructions.max' => 'Chỉ dẫn riêng tối đa '.AiChatSetting::MAX_INSTRUCTIONS.' ký tự.',
            'display_name.max' => 'Tên tối đa '.AiChatSetting::MAX_DISPLAY_NAME.' ký tự.',
            'assistant_name.max' => 'Tên trợ lý tối đa '.AiChatSetting::MAX_ASSISTANT_NAME.' ký tự.',
            'assistant_icon.in' => 'Avatar không hợp lệ.',
            'assistant_color.in' => 'Màu không hợp lệ.',
        ];
    }
}
