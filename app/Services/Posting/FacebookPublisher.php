<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use Illuminate\Http\Client\Response;

/**
 * Facebook Page via the Graph API: `page_id` + `page_access_token`. Text goes to `/feed`, one image to `/photos`, one video to
 * `/videos`, several images as unpublished photos attached to a `/feed` post.
 */
final class FacebookPublisher extends BasePublisher
{
    protected function integrationKey(): string
    {
        return 'facebook';
    }

    protected function platformName(): string
    {
        return 'Facebook';
    }

    protected function requiredCredentials(): array
    {
        return ['page_id' => 'field', 'page_access_token' => 'secret'];
    }

    protected function send(Post $post, array $credentials): PublishResult
    {
        $pageId = rawurlencode($credentials['page_id']);
        $token = $credentials['page_access_token'];
        $images = $this->mediaUrls($post, 'image');
        $videos = $this->mediaUrls($post, 'video');

        if ($videos !== [] && ($images !== [] || count($videos) > 1)) {
            throw PublishAborted::failed('Facebook chỉ đăng được một video, không kèm ảnh.');
        }

        $base = 'https://graph.facebook.com/'.config('posting.graph_version').'/'.$pageId;

        $response = match (true) {
            $videos !== [] => $this->createVideo($base, $token, $post, $videos[0]),
            count($images) === 1 => $this->post($base.'/photos', ['url' => $images[0], 'caption' => $post->body, 'access_token' => $token], true),
            $images !== [] => $this->createWithPhotos($base, $token, $post, $images),
            default => $this->post($base.'/feed', ['message' => $post->body, 'access_token' => $token], true),
        };

        $id = $response->json('post_id') ?? $response->json('id');

        if (! is_string($id) || $id === '') {
            throw PublishAborted::unknown('Facebook phản hồi thiếu mã bài, bài có thể đã được đăng.');
        }

        return PublishResult::published($id, 'https://www.facebook.com/'.$id);
    }

    private function createVideo(string $base, string $token, Post $post, string $url): Response
    {
        return $this->post($base.'/videos', ['file_url' => $url, 'description' => $post->body, 'access_token' => $token], true);
    }

    /** @param  list<string>  $images */
    private function createWithPhotos(string $base, string $token, Post $post, array $images): Response
    {
        $attached = [];

        foreach ($images as $index => $url) {
            $photoId = $this->post($base.'/photos', ['url' => $url, 'published' => 'false', 'access_token' => $token], false)->json('id');

            if (! is_string($photoId)) {
                throw PublishAborted::failed('Facebook không nhận ảnh đính kèm.');
            }

            $attached["attached_media[{$index}]"] = json_encode(['media_fbid' => $photoId], JSON_THROW_ON_ERROR);
        }

        return $this->post($base.'/feed', ['message' => $post->body, 'access_token' => $token, ...$attached], true);
    }

    /** @param  array<string, string>  $form */
    private function post(string $url, array $form, bool $creates): Response
    {
        return $this->execute(fn () => $this->http()->asForm()->post($url, $form), $creates);
    }
}
