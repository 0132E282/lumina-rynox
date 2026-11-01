<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use Illuminate\Http\Client\Response;

/**
 * Instagram Graph API: `ig_user_id` + `access_token`. Needs publicly reachable image URLs. One image uses a media container then
 * `media_publish`; several images use a carousel container. Only `media_publish` can leave the outcome `unknown`. Video is not supported.
 */
final class InstagramPublisher extends BasePublisher
{
    private const MAX_CAROUSEL = 10;

    protected function integrationKey(): string
    {
        return 'instagram';
    }

    protected function platformName(): string
    {
        return 'Instagram';
    }

    protected function requiredCredentials(): array
    {
        return ['ig_user_id' => 'field', 'access_token' => 'secret'];
    }

    protected function send(Post $post, array $credentials): PublishResult
    {
        if ($this->mediaUrls($post, 'video') !== []) {
            throw PublishAborted::failed('Instagram chưa hỗ trợ đăng video.');
        }

        $images = $this->mediaUrls($post, 'image');

        if ($images === []) {
            throw PublishAborted::failed('Instagram yêu cầu ít nhất một ảnh hoặc video.');
        }

        if (count($images) > self::MAX_CAROUSEL) {
            throw PublishAborted::failed('Instagram nhận tối đa '.self::MAX_CAROUSEL.' ảnh mỗi bài.');
        }

        $base = 'https://graph.facebook.com/'.config('posting.graph_version').'/'.rawurlencode($credentials['ig_user_id']);
        $token = $credentials['access_token'];

        if (count($images) === 1) {
            $creationId = $this->containerId($base.'/media', ['image_url' => $images[0], 'caption' => $post->body, 'access_token' => $token]);
        } else {
            $children = array_map(
                fn (string $url): string => $this->containerId($base.'/media', ['image_url' => $url, 'is_carousel_item' => 'true', 'access_token' => $token]),
                $images,
            );
            $creationId = $this->containerId($base.'/media', [
                'media_type' => 'CAROUSEL',
                'children' => implode(',', $children),
                'caption' => $post->body,
                'access_token' => $token,
            ]);
        }

        $published = $this->form($base.'/media_publish', ['creation_id' => $creationId, 'access_token' => $token], true)->json('id');

        if (! is_string($published) || $published === '') {
            throw PublishAborted::unknown('Instagram phản hồi thiếu mã bài, bài có thể đã được đăng.');
        }

        return PublishResult::published($published);
    }

    /** @param  array<string, string>  $form */
    private function containerId(string $url, array $form): string
    {
        $id = $this->form($url, $form, false)->json('id');

        if (! is_string($id) || $id === '') {
            throw PublishAborted::failed('Instagram không tạo được bài nháp từ ảnh.');
        }

        return $id;
    }

    /** @param  array<string, string>  $form */
    private function form(string $url, array $form, bool $creates): Response
    {
        return $this->execute(fn () => $this->http()->asForm()->post($url, $form), $creates);
    }
}
