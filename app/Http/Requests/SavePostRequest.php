<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\Post;
use App\Models\PostTarget;
use App\Models\SocialGroup;
use App\Services\Posting\PostProviders;
use App\Services\Posting\SocialGroupSync;
use App\Support\ResourcePermission;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * * Create/update form of a post. `action` decides the outcome: `draft`, `schedule` (needs a future time) or `publish_now`.
 * * Platform rules (connected, character limit, media types, Instagram media) are checked here, not only in the UI.
 */
class SavePostRequest extends FormRequest
{
    public const ACTION_DRAFT = 'draft';

    public const ACTION_SCHEDULE = 'schedule';

    public const ACTION_PUBLISH_NOW = 'publish_now';

    // * Content-only save of an existing post (title, text, media): status, schedule and platforms stay as they are.
    public const ACTION_SAVE = 'save';

    // * Route middleware checks `posts.{create,update}`; a post that is being sent cannot be edited, and a sent one only through `save`.
    public function authorize(): bool
    {
        $post = $this->route('post');

        if (! $post instanceof Post) {
            return $this->input('action') !== self::ACTION_SAVE;
        }

        return $this->input('action') === self::ACTION_SAVE ? $post->isContentEditable() : $post->isEditable();
    }

    /**
     * * Platforms already saved on the post being edited, or null when creating or when it has none yet: they are chosen once, at creation.
     *
     * @return list<string>|null
     */
    private function savedKeys(): ?array
    {
        $post = $this->route('post');

        if (! $post instanceof Post || ! $post->targets()->exists()) {
            return null;
        }

        return array_values($post->targets()->get(['provider'])->map(fn (PostTarget $target): string => $target->provider)->unique()->all());
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'action' => ['required', Rule::in([self::ACTION_DRAFT, self::ACTION_SCHEDULE, self::ACTION_PUBLISH_NOW, self::ACTION_SAVE])],
            'title' => ['nullable', 'string', 'max:255'],
            'body' => ['required', 'string', 'max:'.Post::MAX_BODY_LENGTH],
            'media' => ['nullable', 'array', 'max:'.Post::MAX_MEDIA],
            'media.*.url' => ['required', 'string', 'url:http,https', 'max:2048'],
            'media.*.type' => ['required', Rule::in(['image', 'video'])],
            // * A post may go only to saved groups: `targets` (feed/page posts) is then optional.
            'targets' => [$this->input('action') === self::ACTION_DRAFT || $this->savedKeys() !== null ? 'nullable' : 'required_without:groups', 'array', 'max:'.count(config('posting.providers', []))],
            'targets.*' => ['string', 'distinct', Rule::in(app(PostProviders::class)->keys())],
            'groups' => ['nullable', 'array'],
            'groups.*' => ['array'],
            'groups.*.*' => ['integer', 'distinct'],
            'audiences' => ['nullable', 'array'],
            'audiences.*' => ['string', Rule::in(PostTarget::AUDIENCES)],
            'scheduled_date' => [$this->input('action') === self::ACTION_SCHEDULE ? 'required' : 'nullable', 'date_format:Y-m-d'],
            'scheduled_time' => [$this->input('action') === self::ACTION_SCHEDULE ? 'required' : 'nullable', 'date_format:H:i'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'body.required' => 'Nội dung bài viết là bắt buộc.',
            'targets.required' => 'Chọn ít nhất một nền tảng để đăng.',
            'scheduled_date.required' => 'Chọn ngày đăng.',
            'scheduled_time.required' => 'Chọn giờ đăng.',
        ];
    }

    /** @return array<int, callable(Validator): void> */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->validateBusinessRules($validator)];
    }

    /** * UTC instant of the chosen date and time (read in `cms.personal_timezone`), or null when either is missing. */
    public function scheduledAt(): ?CarbonImmutable
    {
        $date = $this->input('scheduled_date');
        $time = $this->input('scheduled_time');

        if (! is_string($date) || ! is_string($time) || $date === '' || $time === '') {
            return null;
        }

        return CarbonImmutable::createFromFormat('Y-m-d H:i', "{$date} {$time}", config('cms.personal_timezone'))->utc();
    }

    /** * Audience chosen for a platform; the platform's first (default) one when none was sent, `self` when it has no audience choice. */
    public function audienceFor(string $provider): string
    {
        $audience = $this->input("audiences.{$provider}");
        $supported = array_keys((array) config("posting.providers.{$provider}.audiences", []));

        return is_string($audience) && in_array($audience, $supported, true)
            ? $audience
            : (string) ($supported[0] ?? PostTarget::AUDIENCE_SELF);
    }

    /** @return array<string, list<int>> saved-group ids ticked per provider key (empty lists dropped) */
    public function groupIds(): array
    {
        $result = [];

        foreach ((array) $this->input('groups') as $provider => $ids) {
            $ids = array_values(array_unique(array_map('intval', array_filter((array) $ids, 'is_numeric'))));

            if ($ids !== []) {
                $result[(string) $provider] = $ids;
            }
        }

        return $result;
    }

    private function validateGroups(Validator $validator): void
    {
        foreach ($this->groupIds() as $provider => $ids) {
            if (! in_array($provider, SocialGroupSync::PROVIDERS, true)) {
                $validator->errors()->add('groups', 'Nền tảng này không hỗ trợ đăng vào nhóm.');

                continue;
            }

            $limit = (int) config("posting.providers.{$provider}.posts_per_hour");

            if (count($ids) > $limit) {
                $validator->errors()->add("groups.{$provider}", "Mỗi lần chỉ chọn tối đa {$limit} nhóm cho nền tảng này (giới hạn số bài mỗi giờ).");
            }

            if (SocialGroup::query()->where('provider', $provider)->whereNull('left_at')->whereIn('id', $ids)->count() !== count($ids)) {
                $validator->errors()->add("groups.{$provider}", 'Có nhóm đã chọn không còn trong danh sách nhóm đã lưu.');
            }
        }
    }

    private function validateAudiences(Validator $validator): void
    {
        foreach ((array) $this->input('audiences') as $provider => $audience) {
            $supported = config("posting.providers.{$provider}.audiences");

            if ($supported === null) {
                $validator->errors()->add("audiences.{$provider}", 'Nền tảng này không có lựa chọn đối tượng.');
            } elseif (! in_array($audience, array_keys($supported), true)) {
                $validator->errors()->add("audiences.{$provider}", 'Đối tượng này không dùng được cho nền tảng đã chọn.');
            }
        }
    }

    private function validateBusinessRules(Validator $validator): void
    {
        $this->validateAudiences($validator);
        $this->validateGroups($validator);

        if ($validator->errors()->isNotEmpty()) {
            return;
        }

        $action = (string) $this->input('action');

        if ($action === self::ACTION_SAVE) {
            return;
        }

        if ($action !== self::ACTION_DRAFT && ! ResourcePermission::allows($this->user(), 'posts', 'publish')) {
            $validator->errors()->add('action', 'Bạn không có quyền hẹn giờ hoặc đăng bài.');

            return;
        }

        if ($action === self::ACTION_SCHEDULE && $this->scheduledAt()?->lessThanOrEqualTo(now()) !== false) {
            $validator->errors()->add('scheduled_date', 'Thời gian hẹn phải ở tương lai.');
        }

        $providers = app(PostProviders::class)->all();
        $body = (string) $this->input('body');
        $media = (array) ($this->input('media') ?? []);
        $types = array_values(array_unique(array_column($media, 'type')));

        $keys = $this->savedKeys() ?? array_values(array_unique([...array_values((array) ($this->input('targets') ?? [])), ...array_keys($this->groupIds())]));

        foreach ($keys as $key) {
            $provider = $providers[$key];

            if (! $provider['selectable']) {
                $validator->errors()->add('targets', "{$provider['label']}: {$provider['reason']}");

                continue;
            }

            if (mb_strlen($body) > $provider['max_length']) {
                $validator->errors()->add('body', "{$provider['label']} giới hạn {$provider['max_length']} ký tự.");
            }

            if ($provider['requires_media'] && $media === []) {
                $validator->errors()->add('media', "{$provider['label']} yêu cầu ít nhất một ảnh hoặc video.");
            }

            if (in_array('video', $types, true) && count($media) > 1 && in_array('video', $provider['media_types'], true)) {
                $validator->errors()->add('media', "{$provider['label']} chỉ đăng được một video, không kèm ảnh hoặc video khác.");
            }

            $unsupported = array_diff($types, $provider['media_types']);

            if ($unsupported !== []) {
                $validator->errors()->add('media', "{$provider['label']} chưa hỗ trợ đăng ".(in_array('video', $unsupported, true) ? 'video' : 'ảnh').'.');
            }
        }
    }
}
