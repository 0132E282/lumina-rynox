<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Ai\VoiceService;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use RuntimeException;

/** * Spoken-answer voices of the AI chat (ElevenLabs): the list of sample and own voices, speech for one sentence and cloning a voice from a recording. */
class AiVoiceController extends Controller
{
    public function __construct(private readonly VoiceService $voices) {}

    public function index(): JsonResponse
    {
        if (! $this->voices->enabled()) {
            return response()->json(['enabled' => false, 'voices' => []]);
        }

        return $this->guarded(fn (): array => ['enabled' => true, 'voices' => $this->voices->voices()]);
    }

    public function speak(Request $request): Response|JsonResponse
    {
        $data = $request->validate([
            'voice' => ['required', 'string', 'regex:/^[A-Za-z0-9]{10,40}$/'],
            'text' => ['required', 'string', 'max:'.VoiceService::MAX_TEXT],
        ]);

        if (! $this->voices->enabled()) {
            return response()->json(['message' => 'Chưa cấu hình giọng đọc.'], 422);
        }

        try {
            return response($this->voices->speak($data['voice'], $data['text']), 200, ['Content-Type' => 'audio/mpeg']);
        } catch (RuntimeException|RequestException) {
            return response()->json(['message' => 'Không đọc được bằng giọng này.'], 422);
        }
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'sample' => ['required', 'file', 'mimetypes:audio/mpeg,audio/wav,audio/x-wav,audio/webm,video/webm,audio/mp4,audio/x-m4a,audio/ogg', 'max:'.(int) (VoiceService::MAX_SAMPLE_BYTES / 1024)],
            // * Cloning needs the person's confirmation that the voice is their own or they have the owner's permission.
            'consent' => ['required', 'accepted'],
        ]);

        if (! $this->voices->enabled()) {
            return response()->json(['message' => 'Chưa cấu hình giọng đọc.'], 422);
        }

        return $this->guarded(function () use ($request, $data): array {
            $file = $request->file('sample');
            $id = $this->voices->clone($data['name'], $file->getRealPath(), 'sample.'.($file->guessExtension() ?? 'webm'));

            return ['id' => $id, 'voices' => $this->voices->voices()];
        });
    }

    public function destroy(string $voice): JsonResponse
    {
        abort_unless(preg_match('/^[A-Za-z0-9]{10,40}$/', $voice) === 1, 404);

        return $this->guarded(function () use ($voice): array {
            $this->voices->forget($voice);

            return ['voices' => $this->voices->voices()];
        });
    }

    /** @param callable(): array<string, mixed> $action */
    private function guarded(callable $action): JsonResponse
    {
        try {
            return response()->json($action());
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        } catch (RequestException) {
            return response()->json(['message' => 'Dịch vụ giọng đọc không phản hồi hoặc từ chối yêu cầu.'], 502);
        }
    }
}
