<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Models\Admin;
use App\Models\AiLocalRoot;
use App\Services\Ai\LocalWorkspace;
use App\Services\Ai\LocalWorkspaceException;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\File;
use Spatie\Permission\Models\Permission;
use Tests\Feature\Ai\AiTestCase;

class LocalProjectImportTest extends AiTestCase
{
    private string $base;

    protected function setUp(): void
    {
        parent::setUp();

        $this->base = (string) realpath(sys_get_temp_dir()).'/ai-import-'.bin2hex(random_bytes(6));
        File::ensureDirectoryExists($this->base.'/home/app/src');
        File::ensureDirectoryExists($this->base.'/home/second');
        File::ensureDirectoryExists($this->base.'/home/.ssh/keys');
        File::ensureDirectoryExists($this->base.'/outside/secret');
        file_put_contents($this->base.'/home/app/src/a.txt', 'hello');
        file_put_contents($this->base.'/home/app/file.txt', 'x');
        file_put_contents($this->base.'/outside/secret/notes.txt', 'OUTSIDE');
        symlink($this->base.'/outside/secret', $this->base.'/home/escape');

        config([
            'ai-chat.local_workspace.enabled' => true,
            'ai-chat.local_workspace.roots' => ['envroot' => $this->base.'/home/second'],
            'ai-chat.local_workspace.import_bases' => [$this->base.'/home'],
        ]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->base);

        parent::tearDown();
    }

    /** @param list<string> $folders */
    private function import(Admin $user, string $name, array $folders)
    {
        return $this->actingAs($user)->postJson(route('ai-chat.local.projects.store'), ['name' => $name, 'folders' => $folders]);
    }

    public function test_a_valid_import_appears_next_to_the_env_roots_and_is_readable(): void
    {
        $user = $this->admin();

        $response = $this->import($user, 'My App', [$this->base.'/home/app'])->assertCreated();

        $this->assertSame(['envroot', 'my-app'], array_column($response->json('roots'), 'id'));
        $this->assertSame('…/app', $response->json('roots.1.folder'));
        $this->assertStringNotContainsString($this->base, (string) $response->getContent());
        $this->actingAs($user)->getJson(route('ai-chat.local.tree', ['root' => 'my-app']))->assertOk()->assertJsonPath('paths', ['file.txt', 'src/a.txt']);
        $status = $this->actingAs($user)->getJson(route('ai-chat.local.status'))->assertOk();
        $this->assertStringNotContainsString($this->base, (string) $status->getContent());
        $this->assertSame('My App', $status->json('projects.0.name'));
    }

    public function test_a_project_can_hold_several_folders(): void
    {
        $user = $this->admin();
        File::ensureDirectoryExists($this->base.'/home/third');

        $response = $this->import($user, 'Multi', [$this->base.'/home/app', $this->base.'/home/third'])->assertCreated();

        $this->assertSame(['envroot', 'multi', 'multi-2'], array_column($response->json('roots'), 'id'));
        $this->assertCount(2, $response->json('projects.0.folders'));
    }

    public function test_imports_are_refused_when_the_feature_is_off_not_local_or_in_production(): void
    {
        $user = $this->admin();
        config(['ai-chat.local_workspace.enabled' => false]);
        $this->import($user, 'App', [$this->base.'/home/app'])->assertForbidden();

        config(['ai-chat.local_workspace.enabled' => true]);
        $this->withServerVariables(['REMOTE_ADDR' => '10.1.2.3']);
        $this->import($user, 'App', [$this->base.'/home/app'])->assertForbidden();

        // * Production: the POST would stop at the CSRF check first in this test setup, so the shared guard itself is asserted.
        $this->app->detectEnvironment(fn (): string => 'production');
        $this->assertSame(LocalWorkspaceException::PRODUCTION, app(LocalWorkspace::class)->refusal(Request::create('/', 'POST', server: ['REMOTE_ADDR' => '127.0.0.1'])));

        $this->assertSame(0, AiLocalRoot::query()->count());
    }

    public function test_adding_and_removing_need_the_local_write_permission(): void
    {
        $user = Admin::factory()->create(['system_admin' => false]);
        $user->givePermissionTo(Permission::findOrCreate('ai.local-read', 'web'));
        $user = $user->fresh();

        $this->import($user, 'App', [$this->base.'/home/app'])->assertForbidden();
        $this->actingAs($user)->deleteJson(route('ai-chat.local.projects.destroy', 'app'))->assertForbidden();
    }

    public function test_unsafe_folders_are_refused_with_a_fixed_message(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $user = $this->admin();
        $cases = [
            'missing' => $this->base.'/home/nope',
            'a file' => $this->base.'/home/app/file.txt',
            'relative' => 'home/app',
            'dot dot' => $this->base.'/home/app/../second',
            'symlink escape' => $this->base.'/home/escape',
            'ssh folder' => $this->base.'/home/.ssh/keys',
            'the base itself' => $this->base.'/home',
            'outside the base' => $this->base.'/outside/secret',
            'root' => '/',
            'etc' => '/etc',
            'null byte' => $this->base."/home/a\0pp",
        ];

        foreach ($cases as $label => $folder) {
            $response = $this->import($user, 'Case', [$folder]);

            $this->assertSame(422, $response->status(), $label);
            $this->assertNotEmpty($response->json('errors.folders'), $label);
            $this->assertStringNotContainsString($this->base, (string) $response->getContent(), $label);
        }

        $this->assertSame(0, AiLocalRoot::query()->count());
    }

    public function test_names_are_validated_and_duplicates_refused(): void
    {
        $user = $this->admin();

        $this->import($user, '../etc', [$this->base.'/home/app'])->assertStatus(422)->assertJsonValidationErrors('name');
        $this->import($user, 'App', [$this->base.'/home/app'])->assertCreated();
        $this->import($user, 'App', [$this->base.'/home/app'])->assertStatus(422)->assertJsonPath('errors.name.0', 'Tên dự án đã tồn tại.');
        $this->import($user, 'Envroot', [$this->base.'/home/app'])->assertStatus(422)->assertJsonPath('errors.name.0', 'Tên dự án đã tồn tại.');
        $this->import($user, 'Other', [$this->base.'/home/app'])->assertStatus(201);
        $this->import($user, 'Dup', [$this->base.'/home/second', $this->base.'/home/second'])->assertStatus(422);
    }

    public function test_the_number_of_projects_and_folders_is_limited(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $user = $this->admin();

        $this->import($user, 'Many', array_fill(0, 6, $this->base.'/home/app'))->assertStatus(422);

        foreach (range(1, 10) as $n) {
            File::ensureDirectoryExists($this->base."/home/p{$n}");
            $this->import($user, "P{$n}", [$this->base."/home/p{$n}"])->assertCreated();
        }

        $this->import($user, 'One more', [$this->base.'/home/app'])->assertStatus(422)->assertJsonPath('errors.name.0', 'Đã đạt số dự án tối đa.');
    }

    public function test_imported_roots_belong_to_their_owner_only(): void
    {
        $owner = $this->admin();
        $other = $this->admin();
        $this->import($owner, 'Mine', [$this->base.'/home/app'])->assertCreated();

        $this->actingAs($other)->getJson(route('ai-chat.local.tree', ['root' => 'mine']))->assertNotFound();
        $this->actingAs($other)->getJson(route('ai-chat.local.file', ['root' => 'mine', 'path' => 'file.txt']))->assertNotFound();
        $this->assertSame(['envroot'], array_column($this->actingAs($other)->getJson(route('ai-chat.local.status'))->json('roots'), 'id'));
        $this->actingAs($other)->deleteJson(route('ai-chat.local.projects.destroy', 'mine'))->assertNotFound();
        $this->assertSame(1, AiLocalRoot::query()->count());

        $this->actingAs($owner)->deleteJson(route('ai-chat.local.projects.destroy', 'mine'))->assertOk();
        $this->assertSame(0, AiLocalRoot::query()->count());
        $this->actingAs($owner)->getJson(route('ai-chat.local.tree', ['root' => 'mine']))->assertNotFound();
    }

    public function test_an_imported_root_is_rechecked_on_every_use(): void
    {
        $user = $this->admin();
        $this->import($user, 'Mine', [$this->base.'/home/app'])->assertCreated();

        // * The allowed base moves away: the stored folder is no longer usable and drops out of the list.
        config(['ai-chat.local_workspace.import_bases' => [$this->base.'/elsewhere']]);
        File::ensureDirectoryExists($this->base.'/elsewhere');

        $this->actingAs($user)->getJson(route('ai-chat.local.tree', ['root' => 'mine']))->assertNotFound();
        $this->assertSame(['envroot'], array_column($this->actingAs($user)->getJson(route('ai-chat.local.status'))->json('roots'), 'id'));
    }
}
