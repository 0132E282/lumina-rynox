<?php

declare(strict_types=1);

use App\Http\Controllers\AiChatController;
use App\Http\Controllers\AiChatSettingsController;
use App\Http\Controllers\AiProjectsController;
use App\Http\Controllers\AiProjectToolsController;
use App\Http\Controllers\AiVoiceController;
use App\Http\Controllers\LocalWorkspaceController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

// * AI chat: permission `ai.use` unless a route says otherwise (`ai.local-read` / `ai.local-write` for the local workspace). The `throttle:` buckets are named per feature, never shared.
Route::prefix('ai-chat')->name('ai-chat.')->group(function () {
    Route::middleware(AuthorizeResource::class.':ai,use')->group(function () {
        Route::post('messages', [AiChatController::class, 'send'])->middleware('throttle:10,1,ai')->name('send');
        Route::post('messages/stream', [AiChatController::class, 'sendStream'])->middleware('throttle:10,1,ai')->name('send.stream');
        Route::post('optimize', [AiChatController::class, 'optimize'])->middleware('throttle:10,1,ai')->name('optimize');
        Route::delete('conversations/{conversation}', [AiChatController::class, 'destroyConversation'])->middleware('throttle:30,1,ai-delete')->name('conversations.destroy');
        Route::delete('conversations', [AiChatController::class, 'destroyConversations'])->middleware('throttle:5,1,ai-delete-all')->name('conversations.destroy-all');
        Route::post('messages/{message}/proposals/apply', [AiChatController::class, 'applyProposals'])->middleware('throttle:5,1,ai-apply')->name('proposals.apply');
        Route::post('messages/{message}/proposals/reject', [AiChatController::class, 'rejectProposals'])->middleware('throttle:20,1,ai-apply')->name('proposals.reject');
        Route::get('usage', [AiChatController::class, 'usage'])->middleware('throttle:30,1,ai-usage')->name('usage');

        Route::prefix('github')->name('github.')->group(function () {
            Route::get('repos', [AiChatController::class, 'repos'])->middleware('throttle:30,1,ai-github')->name('repos');
            Route::get('tree', [AiChatController::class, 'tree'])->middleware('throttle:30,1,ai-github')->name('tree');
            Route::get('branches', [AiChatController::class, 'branches'])->middleware('throttle:30,1,ai-github')->name('branches');
            Route::get('file', [AiChatController::class, 'file'])->middleware('throttle:60,1,ai-github')->name('file');
        });

        Route::prefix('settings')->name('settings.')->group(function () {
            Route::put('/', [AiChatSettingsController::class, 'update'])->middleware('throttle:30,1,ai-settings')->name('update');
            Route::delete('/', [AiChatSettingsController::class, 'destroy'])->middleware('throttle:30,1,ai-settings')->name('destroy');
            Route::get('avatar', [AiChatSettingsController::class, 'avatar'])->name('avatar');
            Route::post('avatar', [AiChatSettingsController::class, 'uploadAvatar'])->middleware('throttle:10,1,ai-avatar')->name('avatar.upload');
            Route::delete('avatar', [AiChatSettingsController::class, 'removeAvatar'])->middleware('throttle:30,1,ai-settings')->name('avatar.remove');
        });

        // * Per-project skills, subagents and MCP servers (all off by default); creating one writes into a local project, so `store` needs `ai.local-write` (below).
        Route::get('tools', [AiProjectToolsController::class, 'index'])->middleware('throttle:30,1,ai-tools')->name('tools.index');
        Route::get('tools/info', [AiProjectToolsController::class, 'info'])->middleware('throttle:30,1,ai-tools')->name('tools.info');
        Route::put('tools', [AiProjectToolsController::class, 'toggle'])->middleware('throttle:60,1,ai-tools')->name('tools.toggle');

        // * Code tab: the GitHub repos an admin added to the project list (names only, per admin).
        Route::get('projects', [AiProjectsController::class, 'index'])->middleware('throttle:60,1,ai-projects')->name('projects.index');
        Route::post('projects', [AiProjectsController::class, 'store'])->middleware('throttle:60,1,ai-projects')->name('projects.store');
        Route::delete('projects', [AiProjectsController::class, 'destroy'])->middleware('throttle:60,1,ai-projects')->name('projects.destroy');

        // * Spoken-answer voices (ElevenLabs): the key stays on the server.
        Route::get('voices', [AiVoiceController::class, 'index'])->middleware('throttle:30,1,ai-voice')->name('voices.index');
        Route::post('voices/speak', [AiVoiceController::class, 'speak'])->middleware('throttle:120,1,ai-voice-speak')->name('voices.speak');
        Route::post('voices', [AiVoiceController::class, 'store'])->middleware('throttle:5,1,ai-voice-clone')->name('voices.store');
        Route::delete('voices/{voice}', [AiVoiceController::class, 'destroy'])->middleware('throttle:10,1,ai-voice-clone')->name('voices.destroy');

        Route::get('local/status', [LocalWorkspaceController::class, 'status'])->name('local.status');
    });

    // * "Máy local": off by default (`config/ai-chat.php`); reads need `ai.local-read`.
    Route::middleware(AuthorizeResource::class.':ai,local-read')->prefix('local')->name('local.')->group(function () {
        Route::get('tree', [LocalWorkspaceController::class, 'tree'])->middleware('throttle:30,1,ai-local')->name('tree');
        Route::get('file', [LocalWorkspaceController::class, 'file'])->middleware('throttle:60,1,ai-local')->name('file');
        Route::get('changes', [LocalWorkspaceController::class, 'changes'])->middleware('throttle:60,1,ai-local')->name('changes');
        Route::get('branches', [LocalWorkspaceController::class, 'branches'])->middleware('throttle:60,1,ai-local')->name('branches');
        Route::get('head', [LocalWorkspaceController::class, 'head'])->middleware('throttle:120,1,ai-local')->name('head');
    });

    // * Writing to a local project (import, edits, commands, applying an approved edit, creating a skill or subagent) needs `ai.local-write`.
    Route::middleware(AuthorizeResource::class.':ai,local-write')->group(function () {
        Route::post('local/projects', [LocalWorkspaceController::class, 'storeProject'])->middleware('throttle:10,1,ai-local-import')->name('local.projects.store');
        Route::delete('local/projects/{key}', [LocalWorkspaceController::class, 'destroyProject'])->where('key', '[a-z0-9_-]{1,40}')->middleware('throttle:20,1,ai-local-import')->name('local.projects.destroy');
        Route::post('local/find-folder', [LocalWorkspaceController::class, 'findFolder'])->middleware('throttle:20,1,ai-local-import')->name('local.find-folder');
        Route::post('local/exec', [LocalWorkspaceController::class, 'exec'])->middleware('throttle:30,1,ai-local-exec')->name('local.exec');
        Route::post('local/commit-message', [LocalWorkspaceController::class, 'commitMessage'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:10,1,ai'])->name('local.commit-message');
        Route::post('local/commit', [LocalWorkspaceController::class, 'commit'])->middleware('throttle:20,1,ai-local-write')->name('local.commit');
        Route::post('local/pull-request', [LocalWorkspaceController::class, 'pullRequest'])->middleware('throttle:5,1,ai-local-write')->name('local.pull-request');
        Route::post('local/discard', [LocalWorkspaceController::class, 'discard'])->middleware('throttle:30,1,ai-local-write')->name('local.discard');
        Route::put('local/file', [LocalWorkspaceController::class, 'save'])->middleware('throttle:30,1,ai-local-write')->name('local.file.save');
        Route::post('messages/{message}/proposals/apply-local', [AiChatController::class, 'applyLocalProposals'])->middleware('throttle:20,1,ai-local-write')->name('proposals.apply-local');
        Route::post('messages/{message}/proposals/revert-local', [AiChatController::class, 'revertLocalProposals'])->middleware('throttle:20,1,ai-local-write')->name('proposals.revert-local');
        Route::post('tools', [AiProjectToolsController::class, 'store'])->middleware('throttle:10,1,ai-tools-create')->name('tools.store');
    });
});
