<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\Cv;
use App\Services\Jobs\CvLatexWriter;
use Illuminate\Support\Facades\Http;

class CvLatexTest extends AiTestCase
{
    private const DOC = '\\documentclass{article}\\begin{document}Laravel\\end{document}';

    private function fakeAi(string $text): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['type' => 'text', 'text' => $text]]])]);
    }

    public function test_the_form_button_returns_a_full_latex_document_without_code_fences(): void
    {
        $this->account();
        $this->fakeAi("```latex\n".self::DOC."\n```");

        $this->actingAs($this->admin())->postJson(route('ai.cv-latex'), ['content' => 'Laravel 6 năm'])
            ->assertOk()->assertJson(['latex' => self::DOC]);
    }

    public function test_an_answer_that_is_not_a_full_document_is_refused(): void
    {
        $this->account();
        $this->fakeAi('Xin lỗi, tôi không làm được.');

        $this->actingAs($this->admin())->postJson(route('ai.cv-latex'), ['content' => 'x'])->assertStatus(422)->assertJsonStructure(['message']);
    }

    public function test_the_refresh_writes_when_empty_and_never_over_a_text_the_person_edited(): void
    {
        $this->account();
        $this->fakeAi(self::DOC);
        $cv = Cv::query()->create(['name' => 'CV', 'content' => 'Laravel 6 năm']);
        $writer = app(CvLatexWriter::class);

        $this->assertTrue($writer->refresh($cv));
        $this->assertSame(self::DOC, $cv->refresh()->latex);
        // * Still exactly what the AI wrote: refreshing again is allowed.
        $this->assertTrue($writer->refresh($cv));

        $cv->update(['latex' => '% chỉnh tay '.self::DOC]);
        $this->assertFalse($writer->refresh($cv->refresh()));
        $this->assertStringStartsWith('% chỉnh tay', $cv->refresh()->latex);
    }

    public function test_without_cv_text_nothing_is_asked_of_the_ai(): void
    {
        Http::fake();
        $cv = Cv::query()->create(['name' => 'CV']);

        $this->assertFalse(app(CvLatexWriter::class)->refresh($cv));
        Http::assertNothingSent();
    }
}
