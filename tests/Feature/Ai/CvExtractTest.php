<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\Cv;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

class CvExtractTest extends AiTestCase
{
    private function fakeAi(string $json): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['type' => 'text', 'text' => $json]]])]);
    }

    public function test_a_text_cv_returns_its_text_and_what_the_ai_read_from_it(): void
    {
        $this->account();
        $this->fakeAi('{"position":"Backend Developer","keywords":["PHP","Laravel","PHP","MySQL"]}');
        $file = UploadedFile::fake()->createWithContent('cv-phuc.txt', "Nguyễn Hoàng Phúc\nBackend PHP Laravel 6 năm");

        $this->actingAs($this->admin())->postJson(route('ai.cv-extract'), ['file' => $file])
            ->assertOk()
            ->assertJson(['position' => 'Backend Developer', 'keywords' => ['PHP', 'Laravel', 'MySQL']])
            ->assertJsonPath('text', "Nguyễn Hoàng Phúc\nBackend PHP Laravel 6 năm");
    }

    public function test_a_docx_cv_is_read_from_its_xml(): void
    {
        $this->account();
        $this->fakeAi('{"keywords":[]}');
        $path = tempnam(sys_get_temp_dir(), 'cv').'.docx';
        $zip = new \ZipArchive;
        $zip->open($path, \ZipArchive::CREATE);
        $zip->addFromString('word/document.xml', '<w:document><w:p><w:r><w:t>Laravel &amp; PHP</w:t></w:r></w:p></w:document>');
        $zip->close();

        $this->actingAs($this->admin())->postJson(route('ai.cv-extract'), ['file' => new UploadedFile($path, 'cv.docx', null, null, true)])
            ->assertOk()
            ->assertJsonPath('text', 'Laravel & PHP');
    }

    public function test_an_unreadable_or_wrong_type_of_file_is_refused_before_the_ai_is_called(): void
    {
        $this->account();
        Http::fake();
        $admin = $this->admin();

        $this->actingAs($admin)->postJson(route('ai.cv-extract'), ['file' => UploadedFile::fake()->createWithContent('cv.exe', 'x')])->assertStatus(422);
        $this->postJson(route('ai.cv-extract'), ['file' => UploadedFile::fake()->createWithContent('scan.pdf', 'not really a pdf')])->assertStatus(422)->assertJsonStructure(['message']);
        Http::assertNothingSent();
    }

    public function test_it_needs_the_ai_permission(): void
    {
        Http::fake();

        $this->actingAs($this->admin(false))->postJson(route('ai.cv-extract'), ['file' => UploadedFile::fake()->createWithContent('cv.txt', 'x')])->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_the_uploaded_file_is_kept_under_a_random_name_and_downloadable_by_its_cv(): void
    {
        Storage::fake();
        $this->account();
        $this->fakeAi('{"keywords":["PHP"]}');
        $admin = $this->actingAs($this->admin());

        $path = $admin->postJson(route('ai.cv-extract'), ['file' => UploadedFile::fake()->createWithContent('Hồ sơ của tôi.txt', 'Laravel')])->assertOk()->json('file_path');

        $this->assertMatchesRegularExpression('#^cvs/[0-9a-f-]{36}\.txt$#', $path);
        Storage::assertExists($path);

        $cv = Cv::query()->create(['name' => 'CV Phúc', 'file_path' => $path]);
        $this->get(route('cvs.file', $cv))->assertOk()->assertDownload('cv-phuc.txt');

        $cv->delete();
        Storage::assertMissing($path);
    }

    public function test_a_cv_cannot_point_at_a_path_outside_the_stored_uploads(): void
    {
        $this->assertNotEmpty(Validator::make(['file_path' => '../../.env'], ['file_path' => Cv::rules()['file_path']])->errors()->all());
        $this->assertEmpty(Validator::make(['file_path' => 'cvs/0b9e5c8e-1111-4222-8333-444455556666.pdf'], ['file_path' => Cv::rules()['file_path']])->errors()->all());
    }
}
