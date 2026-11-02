<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Spoken answers through ElevenLabs: lists the account's voices (its ready-made sample voices and the ones the person cloned), speaks a sentence with one of them and clones a new voice from a recording.
 * ! The API key stays on the server and never reaches the browser. Only the ids and names of voices go out.
 */
class VoiceService
{
    private const API = 'https://api.elevenlabs.io/v1';

    private const VOICES_TTL_SECONDS = 600;

    public const MAX_TEXT = 1000;

    public const MAX_SAMPLE_BYTES = 10_000_000;

    public function enabled(): bool
    {
        return is_string(config('services.elevenlabs.key')) && config('services.elevenlabs.key') !== '';
    }

    /**
     * @return list<array{id: string, name: string, own: bool, preview: string|null}>
     */
    public function voices(): array
    {
        return Cache::remember('ai.voices', self::VOICES_TTL_SECONDS, function (): array {
            $rows = (array) $this->client()->get(self::API.'/voices')->throw()->json('voices');

            return collect($rows)
                ->map(fn (array $row): array => [
                    'id' => (string) $row['voice_id'],
                    'name' => (string) ($row['name'] ?? $row['voice_id']),
                    // * "cloned" and "generated" voices belong to this account; "premade" ones are the shared samples.
                    'own' => ($row['category'] ?? 'premade') !== 'premade',
                    'preview' => is_string($row['preview_url'] ?? null) ? $row['preview_url'] : null,
                ])
                ->values()
                ->all();
        });
    }

    /** * MP3 bytes of the text spoken with a voice of this account. */
    public function speak(string $voiceId, string $text): string
    {
        $this->knownVoice($voiceId);

        return $this->client()
            ->withHeaders(['Accept' => 'audio/mpeg'])
            ->post(self::API.'/text-to-speech/'.rawurlencode($voiceId).'?output_format=mp3_44100_64', [
                'text' => mb_substr($text, 0, self::MAX_TEXT),
                'model_id' => (string) config('services.elevenlabs.model'),
            ])
            ->throw()
            ->body();
    }

    /** * Clones a voice from a recording the person made of their own voice; returns its id. */
    public function clone(string $name, string $path, string $filename): string
    {
        $response = $this->client()
            ->attach('files', (string) file_get_contents($path), $filename)
            ->post(self::API.'/voices/add', ['name' => $name])
            ->throw();

        Cache::forget('ai.voices');

        return (string) $response->json('voice_id');
    }

    public function forget(string $voiceId): void
    {
        $voice = $this->knownVoice($voiceId);

        if (! $voice['own']) {
            throw new RuntimeException('Chỉ xoá được giọng do bạn tạo.');
        }

        $this->client()->delete(self::API.'/voices/'.rawurlencode($voiceId))->throw();
        Cache::forget('ai.voices');
    }

    /** @return array{id: string, name: string, own: bool, preview: string|null} */
    private function knownVoice(string $voiceId): array
    {
        foreach ($this->voices() as $voice) {
            if ($voice['id'] === $voiceId) {
                return $voice;
            }
        }

        throw new RuntimeException('Không có giọng này.');
    }

    private function client(): PendingRequest
    {
        return Http::withHeaders(['xi-api-key' => (string) config('services.elevenlabs.key')])->timeout(30);
    }
}
