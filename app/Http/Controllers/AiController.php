<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\AiAccount;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\AutoReplySwitch;
use App\Services\Ai\CvTextExtractor;
use App\Services\Ai\ReportBuilder;
use App\Services\Posting\PostProviders;
use App\Support\PersonalClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * * Right-sidebar assistant, the post draft helper and the global automatic-reply switch (permission `ai.use`, route middleware). Answers are text for a person to read or edit;
 * * only an enabled switch lets `AutoReplyJob` answer customers; nothing here publishes a post. Failures return the fixed `AiException` text.
 */
class AiController extends Controller
{
    public function __construct(private readonly AiAssistant $assistant) {}

    public function ask(Request $request, ReportBuilder $reports): JsonResponse
    {
        $validated = $request->validate([
            'report' => ['nullable', 'boolean'],
            'question' => [Rule::requiredIf(! $request->boolean('report')), 'nullable', 'string', 'max:2000'],
        ]);

        try {
            if ($request->boolean('report')) {
                $report = $reports->forDay(PersonalClock::today());

                return response()->json(['answer' => $reports->format($report)."\n\n".$this->assistant->summarizeReport($report)]);
            }

            return response()->json(['answer' => $this->assistant->ask($validated['question'])]);
        } catch (AiException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    /** * Global "Trả lời tự động" switch. Turning it on needs at least one enabled AI account for replies, otherwise it could only fail. */
    public function autoReply(Request $request, AutoReplySwitch $switch): JsonResponse
    {
        $validated = $request->validate(['enabled' => ['required', 'boolean']]);
        $enabled = (bool) $validated['enabled'];

        if ($enabled && ! AiAccount::query()->where('enabled', true)->get()->contains(fn (AiAccount $account): bool => $account->allowsPurpose(AiAccount::PURPOSE_SUGGEST_REPLY))) {
            return response()->json(['message' => AiException::NOT_CONFIGURED], 422);
        }

        $switch->set($enabled);

        return response()->json(['enabled' => $switch->enabled()]);
    }

    /** * A CV file goes in; its text plus the search keywords the AI read from it come back to fill the CV form, and the file is kept on the private disk. */
    public function extractCv(Request $request, CvTextExtractor $extractor): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:5120', 'extensions:'.implode(',', CvTextExtractor::EXTENSIONS)]]);

        $text = $extractor->extract($request->file('file'));

        if ($text === null) {
            return response()->json(['message' => 'Không đọc được chữ trong file này (PDF dạng ảnh scan chưa được hỗ trợ).'], 422);
        }

        try {
            $profile = $this->assistant->extractCvProfile($text);
        } catch (AiException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        // * Kept on the private disk under a random name (the client's file name is never used); the form saves this path with the CV.
        $file = $request->file('file');
        $path = $file->storeAs('cvs', Str::uuid()->toString().'.'.strtolower($file->getClientOriginalExtension()));

        return response()->json(['text' => $text, 'position' => $profile['position'], 'keywords' => $profile['keywords'], 'file_path' => $path === false ? null : $path]);
    }

    /** * "AI viết CV bằng LaTeX" on the CV form: the text in the form (not yet saved) comes in, LaTeX source goes back to fill the field. */
    public function cvLatex(Request $request): JsonResponse
    {
        $validated = $request->validate(['content' => ['required', 'string', 'max:20000']]);

        try {
            $latex = $this->assistant->cvLatex($validated['content']);
        } catch (AiException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return $latex === null
            ? response()->json(['message' => 'AI chưa viết được CV dạng LaTeX hoàn chỉnh, hãy thử lại.'], 422)
            : response()->json(['latex' => $latex]);
    }

    public function postDraft(Request $request, PostProviders $providers): JsonResponse
    {
        $validated = $request->validate([
            'idea' => ['required', 'string', 'max:2000'],
            'platform' => ['nullable', 'string', Rule::in($providers->keys())],
        ]);
        $platform = $validated['platform'] ?? null;

        try {
            $draft = $this->assistant->postDraft(
                $validated['idea'],
                $platform === null ? null : $providers->label($platform),
                $platform === null ? null : (int) config("posting.providers.{$platform}.max_length"),
            );

            return response()->json(['title' => $draft['title'], 'draft' => $draft['body']]);
        } catch (AiException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }
}
