<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Services\Ai\LocalWorkspace;
use Illuminate\Foundation\Http\FormRequest;

/** * A project of local folders. Permission is `ai.local-write` (route middleware); the folders' location rules are enforced by LocalWorkspace::importProject. */
class ImportLocalProjectRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:60', 'regex:/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u'],
            'folders' => ['required', 'array', 'min:1', 'max:'.LocalWorkspace::MAX_FOLDERS_PER_PROJECT],
            'folders.*' => ['required', 'string', 'max:500'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'name.required' => 'Nhập tên dự án.',
            'name.max' => 'Tên dự án tối đa 60 ký tự.',
            'name.regex' => 'Tên chỉ gồm chữ, số, dấu cách, gạch dưới, gạch ngang và dấu chấm.',
            'folders.required' => 'Thêm ít nhất một thư mục.',
            'folders.min' => 'Thêm ít nhất một thư mục.',
            'folders.max' => 'Mỗi dự án tối đa '.LocalWorkspace::MAX_FOLDERS_PER_PROJECT.' thư mục.',
        ];
    }
}
