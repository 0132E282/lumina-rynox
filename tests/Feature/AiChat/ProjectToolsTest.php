<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Services\Ai\AiAssistant;
use App\Services\Ai\CliLlmClient;
use App\Services\Ai\McpPolicy;
use App\Services\Ai\ProjectTools;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Tests\Feature\Ai\AiTestCase;

class ProjectToolsTest extends AiTestCase
{
    private string $base;

    private string|false $home = false;

    protected function setUp(): void
    {
        parent::setUp();

        $this->base = (string) realpath(sys_get_temp_dir()).'/ai-tools-'.bin2hex(random_bytes(6));
        File::ensureDirectoryExists($this->base.'/root/.agents/skills/lint');
        file_put_contents($this->base.'/root/.agents/skills/lint/SKILL.md', "---\nname: lint\ndescription: Chạy lint\n---\nDùng pint.\n");
        config(['ai-chat.local_workspace.enabled' => true, 'ai-chat.local_workspace.roots' => ['work' => $this->base.'/root']]);
        // * The real machine-wide skills of whoever runs the tests must not leak in.
        $this->home = getenv('HOME');
        File::ensureDirectoryExists($this->base.'/home');
        putenv('HOME='.$this->base.'/home');
        Cache::forget('ai.mcp.servers');
        Process::fake(['*' => Process::result("filesystem: npx -y @mcp/fs - ✓ Connected\ngithub: https://x.test - ✗ Failed to connect\n")]);
    }

    protected function tearDown(): void
    {
        putenv($this->home === false ? 'HOME' : 'HOME='.$this->home);
        File::deleteDirectory($this->base);

        parent::tearDown();
    }

    public function test_skills_are_on_by_default_and_mcp_shows_names_and_status_only(): void
    {
        $response = $this->actingAs($this->admin())->getJson(route('ai-chat.tools.index', ['project' => 'local:work']))->assertOk();

        $response->assertJsonPath('skills.0.name', 'lint')->assertJsonPath('skills.0.description', 'Chạy lint')->assertJsonPath('enabled.skill', ['lint'])->assertJsonPath('enabled.mcp', [])->assertJsonPath('mcp.0.name', 'filesystem')->assertJsonPath('mcp.0.status', 'Connected');
        $this->assertStringNotContainsString('npx', (string) $response->getContent());
        $this->assertStringNotContainsString('x.test', (string) $response->getContent());
    }

    public function test_a_skill_and_an_agent_are_created_in_the_shared_agents_folder_and_never_overwritten(): void
    {
        $user = $this->admin();
        $payload = ['project' => 'local:work', 'kind' => 'agent', 'name' => 'reviewer', 'description' => 'Review code', 'body' => 'Kiểm tra diff.'];

        $this->actingAs($user)->postJson(route('ai-chat.tools.store'), $payload)->assertCreated()->assertJsonPath('path', '.agents/agents/reviewer.md');
        $this->assertFileExists($this->base.'/root/.agents/agents/reviewer.md');
        $this->actingAs($user)->postJson(route('ai-chat.tools.store'), $payload)->assertStatus(409);
        $this->actingAs($user)->postJson(route('ai-chat.tools.store'), [...$payload, 'name' => '../evil'])->assertUnprocessable();
        $this->actingAs($user)->postJson(route('ai-chat.tools.store'), [...$payload, 'project' => 'owner/repo'])->assertUnprocessable();
    }

    public function test_only_enabled_skills_reach_the_ai_and_the_toggle_is_per_project(): void
    {
        $user = $this->admin();
        $seen = [];
        $this->app->instance(AiAssistant::class, new class($seen) extends AiAssistant
        {
            public function __construct(public array &$seen) {}

            public function chat(array $history, string $message, ?int $accountId = null, ?string $model = null, ?string $context = null, bool $allowEdits = false, string $mode = AiAssistant::MODE_AUTO, array $profile = []): string
            {
                $this->seen[] = $context;

                return 'ok';
            }
        });

        $this->actingAs($user)->postJson(route('ai-chat.send'), ['message' => 'hi', 'local_root' => 'work'])->assertOk();
        // * On by default: the name is known, the text only when the message names the skill.
        $this->assertStringContainsString('Skill đang bật: lint', (string) $seen[0]);
        $this->assertStringNotContainsString('Dùng pint', (string) $seen[0]);
        $this->actingAs($user)->postJson(route('ai-chat.send'), ['message' => 'dùng lint đi', 'local_root' => 'work'])->assertOk();
        $this->assertStringContainsString('Dùng pint', (string) $seen[1]);

        $this->actingAs($user)->getJson(route('ai-chat.tools.index', ['project' => 'local:work']))->assertJsonPath('enabled.skill', ['lint']);
        $this->actingAs($user)->putJson(route('ai-chat.tools.toggle'), ['project' => 'local:work', 'kind' => 'skill', 'name' => 'lint', 'on' => false])->assertOk();
        $this->actingAs($user)->getJson(route('ai-chat.tools.index', ['project' => 'local:work']))->assertJsonPath('enabled.skill', []);
        $this->actingAs($user)->postJson(route('ai-chat.send'), ['message' => 'dùng lint đi', 'local_root' => 'work'])->assertOk();
        $this->assertStringNotContainsString('Skill đang bật', (string) $seen[2]);
    }

    public function test_mcp_servers_are_blocked_unless_switched_on(): void
    {
        Process::fake(['*' => Process::result('ok')]);
        $this->app->make(McpPolicy::class)->allow([]);
        (new CliLlmClient('anthropic', null))->complete('s', 'p');
        Process::assertRan(fn (PendingProcess $process) => in_array('--strict-mcp-config', (array) $process->command, true));

        Cache::put('ai.mcp.servers', [['name' => 'filesystem', 'status' => 'Connected'], ['name' => 'github', 'status' => 'Connected']], 60);
        $this->app->make(McpPolicy::class)->allow(['github']);
        (new CliLlmClient('anthropic', null))->complete('s', 'p');
        Process::assertRan(fn (PendingProcess $process) => in_array('mcp__filesystem', explode(',', implode(',', (array) $process->command)), true) && ! in_array('mcp__github', explode(',', implode(',', (array) $process->command)), true));
    }

    public function test_machine_wide_skills_are_listed_and_switched_on_for_every_project(): void
    {
        File::ensureDirectoryExists($this->base.'/home/.agents/skills/global-one');
        file_put_contents($this->base.'/home/.agents/skills/global-one/SKILL.md', "---\nname: global-one\ndescription: Dùng chung\n---\nNội dung toàn cục.\n");

        $user = $this->admin();

        $this->actingAs($user)->getJson(route('ai-chat.tools.index', ['project' => 'local:work']))->assertOk()->assertJsonPath('global_skills.0.name', 'global-one')->assertJsonPath('global_skills.0.description', 'Dùng chung');
        // * Machine-wide subagents (`~/.agents/agents/*.md`) are listed and switched like skills; a bad name is still refused.
        File::ensureDirectoryExists($this->base.'/home/.agents/agents');
        file_put_contents($this->base.'/home/.agents/agents/global-helper.md', "---\nname: global-helper\ndescription: Trợ giúp chung\n---\nVai trò toàn cục.\n");
        $this->actingAs($user)->getJson(route('ai-chat.tools.index', ['project' => 'local:work']))->assertOk()->assertJsonPath('global_agents.0.name', 'global-helper')->assertJsonPath('global_agents.0.description', 'Trợ giúp chung');
        $this->actingAs($user)->putJson(route('ai-chat.tools.toggle'), ['project' => 'global', 'kind' => 'agent', 'name' => 'global-helper', 'on' => false])->assertOk();
        $this->actingAs($user)->putJson(route('ai-chat.tools.toggle'), ['project' => 'global', 'kind' => 'agent', 'name' => '../x', 'on' => true])->assertUnprocessable();
        $this->actingAs($user)->putJson(route('ai-chat.tools.toggle'), ['project' => 'global', 'kind' => 'skill', 'name' => '../x', 'on' => true])->assertUnprocessable();
        $tools = app(ProjectTools::class);
        $context = $tools->forChat($user, [], true, 'dùng global-one');
        $this->assertStringContainsString('Nội dung toàn cục', (string) $context['section']);
        $this->assertNull($tools->forChat($user, [], false, 'dùng global-one')['section']);

        $this->actingAs($user)->putJson(route('ai-chat.tools.toggle'), ['project' => 'global', 'kind' => 'skill', 'name' => 'global-one', 'on' => false])->assertOk();
        $this->assertNull($tools->forChat($user, [], true, 'dùng global-one')['section']);

    }
}
