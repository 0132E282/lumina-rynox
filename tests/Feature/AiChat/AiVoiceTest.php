<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Ai\AiTestCase;

class AiVoiceTest extends AiTestCase
{
    private function fakeService(): void
    {
        config(['services.elevenlabs.key' => 'secret-key']);
        Cache::forget('ai.voices');
        Http::fake([
            'api.elevenlabs.io/v1/voices/add' => Http::response(['voice_id' => 'clonedvoice01']),
            'api.elevenlabs.io/v1/voices' => Http::response(['voices' => [
                ['voice_id' => 'premadevoice1', 'name' => 'Sample', 'category' => 'premade', 'preview_url' => 'https://x/y.mp3'],
                ['voice_id' => 'clonedvoice01', 'name' => 'Mine', 'category' => 'cloned'],
            ]]),
            'api.elevenlabs.io/v1/text-to-speech/*' => Http::response('MP3BYTES', 200, ['Content-Type' => 'audio/mpeg']),
        ]);
    }

    public function test_without_a_key_the_list_is_empty_and_never_calls_out(): void
    {
        config(['services.elevenlabs.key' => null]);
        Http::fake();

        $this->actingAs($this->admin())->getJson(route('ai-chat.voices.index'))->assertOk()->assertJsonPath('enabled', false)->assertJsonPath('voices', []);
        Http::assertNothingSent();
    }

    public function test_it_lists_sample_and_own_voices_without_the_key(): void
    {
        $this->fakeService();

        $response = $this->actingAs($this->admin())->getJson(route('ai-chat.voices.index'))->assertOk()
            ->assertJsonPath('voices.0.own', false)
            ->assertJsonPath('voices.1.own', true);

        $this->assertStringNotContainsString('secret-key', (string) $response->getContent());
    }

    public function test_it_speaks_only_with_a_voice_of_the_account(): void
    {
        $this->fakeService();
        $user = $this->admin();

        $this->actingAs($user)->postJson(route('ai-chat.voices.speak'), ['voice' => 'premadevoice1', 'text' => 'Xin chào'])->assertOk()->assertHeader('Content-Type', 'audio/mpeg');
        $this->actingAs($user)->postJson(route('ai-chat.voices.speak'), ['voice' => 'unknownvoice1', 'text' => 'Xin chào'])->assertStatus(422);
    }

    public function test_cloning_needs_consent_and_a_recording(): void
    {
        $this->fakeService();
        $user = $this->admin();
        $sample = UploadedFile::fake()->create('me.wav', 200, 'audio/wav');

        $this->actingAs($user)->postJson(route('ai-chat.voices.store'), ['name' => 'Tôi', 'sample' => $sample])->assertStatus(422);
        $this->actingAs($user)->postJson(route('ai-chat.voices.store'), ['name' => 'Tôi', 'sample' => $sample, 'consent' => true])->assertOk()->assertJsonPath('id', 'clonedvoice01');
    }

    public function test_only_own_voices_can_be_removed(): void
    {
        $this->fakeService();
        $user = $this->admin();

        $this->actingAs($user)->deleteJson(route('ai-chat.voices.destroy', 'premadevoice1'))->assertStatus(422);
    }
}
