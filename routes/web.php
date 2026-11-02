<?php

use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\AiAccountController;
use App\Http\Controllers\AiChatController;
use App\Http\Controllers\AiChatSettingsController;
use App\Http\Controllers\AiController;
use App\Http\Controllers\AiProjectToolsController;
use App\Http\Controllers\ApiKeyController;
use App\Http\Controllers\AppPasswordController;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ChatLinkPreviewController;
use App\Http\Controllers\CvFileController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\InboxController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\ItemController;
use App\Http\Controllers\JobPostingController;
use App\Http\Controllers\LinkedInOAuthController;
use App\Http\Controllers\LocalWorkspaceController;
use App\Http\Controllers\MailboxController;
use App\Http\Controllers\MailController;
use App\Http\Controllers\MessengerAccountController;
use App\Http\Controllers\MessengerLoginController;
use App\Http\Controllers\PostController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\SocialGroupController;
use App\Http\Controllers\SystemController;
use App\Http\Controllers\ViewController;
use App\Http\Controllers\ZaloAccountController;
use App\Http\Controllers\ZaloContactsController;
use App\Http\Controllers\ZaloLoginController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

require __DIR__.'/settings.php';

Route::middleware(['auth', 'web'])->group(function () {
    // * `/` is the AI chat home (permission `ai.use`; without it the controller sends the person to the dashboard). The dashboard moved to `/dashboard`.
    Route::get('/', [AiChatController::class, 'index'])->name('home');
    Route::get('dashboard', [DashboardController::class, 'index'])->name('dashboard');
    Route::post('ai-chat/messages', [AiChatController::class, 'send'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:10,1,ai'])->name('ai-chat.send');
    Route::delete('ai-chat/conversations/{conversation}', [AiChatController::class, 'destroyConversation'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-delete'])->name('ai-chat.conversations.destroy');
    Route::delete('ai-chat/conversations', [AiChatController::class, 'destroyConversations'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:5,1,ai-delete-all'])->name('ai-chat.conversations.destroy-all');
    Route::post('ai-chat/messages/{message}/proposals/apply', [AiChatController::class, 'applyProposals'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:5,1,ai-apply'])->name('ai-chat.proposals.apply');
    Route::post('ai-chat/messages/{message}/proposals/reject', [AiChatController::class, 'rejectProposals'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:20,1,ai-apply'])->name('ai-chat.proposals.reject');
    Route::get('ai-chat/github/repos', [AiChatController::class, 'repos'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-github'])->name('ai-chat.github.repos');
    Route::get('ai-chat/github/tree', [AiChatController::class, 'tree'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-github'])->name('ai-chat.github.tree');
    Route::get('ai-chat/github/file', [AiChatController::class, 'file'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:60,1,ai-github'])->name('ai-chat.github.file');
    Route::get('ai-chat/usage', [AiChatController::class, 'usage'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-usage'])->name('ai-chat.usage');
    Route::put('ai-chat/settings', [AiChatSettingsController::class, 'update'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-settings'])->name('ai-chat.settings.update');
    Route::delete('ai-chat/settings', [AiChatSettingsController::class, 'destroy'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-settings'])->name('ai-chat.settings.destroy');
    Route::get('ai-chat/settings/avatar', [AiChatSettingsController::class, 'avatar'])->middleware(AuthorizeResource::class.':ai,use')->name('ai-chat.settings.avatar');
    Route::post('ai-chat/settings/avatar', [AiChatSettingsController::class, 'uploadAvatar'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:10,1,ai-avatar'])->name('ai-chat.settings.avatar.upload');
    Route::delete('ai-chat/settings/avatar', [AiChatSettingsController::class, 'removeAvatar'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-settings'])->name('ai-chat.settings.avatar.remove');
    // * "Máy local": off by default (`config/ai-chat.php`); reads need `ai.local-read`, applying an approved edit needs `ai.local-write`.
    Route::get('ai-chat/local/status', [LocalWorkspaceController::class, 'status'])->middleware(AuthorizeResource::class.':ai,use')->name('ai-chat.local.status');
    Route::post('ai-chat/local/projects', [LocalWorkspaceController::class, 'storeProject'])->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:10,1,ai-local-import'])->name('ai-chat.local.projects.store');
    Route::delete('ai-chat/local/projects/{key}', [LocalWorkspaceController::class, 'destroyProject'])->where('key', '[a-z0-9_-]{1,40}')->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:20,1,ai-local-import'])->name('ai-chat.local.projects.destroy');
    Route::post('ai-chat/local/find-folder', [LocalWorkspaceController::class, 'findFolder'])->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:20,1,ai-local-import'])->name('ai-chat.local.find-folder');
    Route::get('ai-chat/local/tree', [LocalWorkspaceController::class, 'tree'])->middleware([AuthorizeResource::class.':ai,local-read', 'throttle:30,1,ai-local'])->name('ai-chat.local.tree');
    Route::get('ai-chat/local/file', [LocalWorkspaceController::class, 'file'])->middleware([AuthorizeResource::class.':ai,local-read', 'throttle:60,1,ai-local'])->name('ai-chat.local.file');
    Route::get('ai-chat/local/changes', [LocalWorkspaceController::class, 'changes'])->middleware([AuthorizeResource::class.':ai,local-read', 'throttle:60,1,ai-local'])->name('ai-chat.local.changes');
    Route::get('ai-chat/local/head', [LocalWorkspaceController::class, 'head'])->middleware([AuthorizeResource::class.':ai,local-read', 'throttle:120,1,ai-local'])->name('ai-chat.local.head');
    Route::put('ai-chat/local/file', [LocalWorkspaceController::class, 'save'])->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:30,1,ai-local-write'])->name('ai-chat.local.file.save');
    Route::post('ai-chat/messages/{message}/proposals/apply-local', [AiChatController::class, 'applyLocalProposals'])->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:20,1,ai-local-write'])->name('ai-chat.proposals.apply-local');
    Route::post('ai-chat/messages/{message}/proposals/revert-local', [AiChatController::class, 'revertLocalProposals'])->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:20,1,ai-local-write'])->name('ai-chat.proposals.revert-local');
    // * Per-project skills, subagents and MCP servers (all off by default); creating a skill or subagent writes into a local project, so it needs `ai.local-write`.
    Route::get('ai-chat/tools', [AiProjectToolsController::class, 'index'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:30,1,ai-tools'])->name('ai-chat.tools.index');
    Route::put('ai-chat/tools', [AiProjectToolsController::class, 'toggle'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:60,1,ai-tools'])->name('ai-chat.tools.toggle');
    Route::post('ai-chat/tools', [AiProjectToolsController::class, 'store'])->middleware([AuthorizeResource::class.':ai,local-write', 'throttle:10,1,ai-tools-create'])->name('ai-chat.tools.store');
    Route::post('ai-chat/optimize', [AiChatController::class, 'optimize'])->middleware([AuthorizeResource::class.':ai,use', 'throttle:10,1,ai'])->name('ai-chat.optimize');
    Route::get('system', [SystemController::class, 'index'])->name('system.index');
    Route::get('activity-logs', [ActivityLogController::class, 'index'])->name('activity-logs.index');

    Route::get('api-keys', [ApiKeyController::class, 'index'])->name('api-keys.index');
    Route::post('api-keys', [ApiKeyController::class, 'store'])->name('api-keys.store');
    Route::post('api-keys/{id}/revoke', [ApiKeyController::class, 'revoke'])->name('api-keys.revoke');
    Route::delete('api-keys/{id}', [ApiKeyController::class, 'destroy'])->name('api-keys.destroy');

    Route::get('app-password/status', [AppPasswordController::class, 'status'])->name('app-password.status');
    Route::post('app-password/confirm', [AppPasswordController::class, 'confirm'])->name('app-password.confirm');

    // * Integrations: unknown providers 404 in the controller; permissions come from `integrations.{view,update}`.
    Route::prefix('integrations')->name('integrations.')->where(['provider' => '[a-z_]+'])->group(function () {
        Route::get('/', [IntegrationController::class, 'index'])->middleware(AuthorizeResource::class.':integrations,view')->name('index');
        // * Zalo QR sign-in (proxied to the sidecar); before `{provider}` for clarity.
        Route::post('zalo/qr', [ZaloLoginController::class, 'start'])->middleware(AuthorizeResource::class.':integrations,update')->name('zalo.qr.start');
        Route::get('zalo/qr', [ZaloLoginController::class, 'status'])->middleware(AuthorizeResource::class.':integrations,update')->name('zalo.qr.status');
        Route::delete('zalo/qr', [ZaloLoginController::class, 'cancel'])->middleware(AuthorizeResource::class.':integrations,update')->name('zalo.qr.cancel');
        // * Per-account actions: scopes, disconnect and address book sync (3 runs per 10 minutes, to keep the unofficial channel's call volume low).
        Route::put('zalo/accounts/{account}', [ZaloAccountController::class, 'update'])->whereNumber('account')->middleware(AuthorizeResource::class.':integrations,update')->name('zalo.accounts.update');
        Route::delete('zalo/accounts/{account}', [ZaloAccountController::class, 'destroy'])->whereNumber('account')->middleware([AuthorizeResource::class.':integrations,update', 'throttle:5,10'])->name('zalo.accounts.destroy');
        Route::post('zalo/accounts/{account}/contacts/sync', [ZaloContactsController::class, 'sync'])->whereNumber('account')->middleware([AuthorizeResource::class.':integrations,update', 'throttle:3,10'])->name('zalo.contacts.sync');
        Route::post('linkedin/oauth/start', [LinkedInOAuthController::class, 'start'])->middleware(AuthorizeResource::class.':integrations,update')->name('linkedin.oauth.start');
        Route::get('linkedin/oauth/callback', [LinkedInOAuthController::class, 'callback'])->middleware(AuthorizeResource::class.':integrations,update')->name('linkedin.oauth.callback');
        // * One-shot cookie sign-in for the Messenger bridge (Provisioning API); before `{provider}` for clarity.
        Route::post('messenger/login', [MessengerLoginController::class, 'login'])->middleware([AuthorizeResource::class.':integrations,update', 'throttle:5,10'])->name('messenger.login');
        Route::get('messenger/accounts/{account}/avatar', [MessengerAccountController::class, 'avatar'])->whereNumber('account')->middleware(AuthorizeResource::class.':integrations,view')->name('messenger.accounts.avatar');
        Route::put('messenger/accounts/{account}', [MessengerAccountController::class, 'update'])->whereNumber('account')->middleware(AuthorizeResource::class.':integrations,update')->name('messenger.accounts.update');
        Route::delete('messenger/accounts/{account}', [MessengerAccountController::class, 'destroy'])->whereNumber('account')->middleware([AuthorizeResource::class.':integrations,update', 'throttle:5,10'])->name('messenger.accounts.destroy');
        Route::delete('messenger/accounts/{account}/forget', [MessengerAccountController::class, 'forget'])->whereNumber('account')->middleware([AuthorizeResource::class.':integrations,update', 'throttle:5,10'])->name('messenger.accounts.forget');
        Route::post('ai/cli/login', [AiAccountController::class, 'cliLogin'])->middleware([AuthorizeResource::class.':integrations,update', 'throttle:6,1'])->name('ai.cli.login');
        Route::get('ai/cli/status', [AiAccountController::class, 'cliStatus'])->middleware([AuthorizeResource::class.':integrations,update', 'throttle:60,1'])->name('ai.cli.status');
        Route::post('ai/accounts', [AiAccountController::class, 'store'])->middleware(AuthorizeResource::class.':integrations,update')->name('ai.accounts.store');
        Route::put('ai/settings', [AiAccountController::class, 'settings'])->middleware(AuthorizeResource::class.':integrations,update')->name('ai.settings');
        Route::put('ai/accounts/{account}', [AiAccountController::class, 'update'])->whereNumber('account')->middleware(AuthorizeResource::class.':integrations,update')->name('ai.accounts.update');
        Route::post('ai/accounts/{account}/toggle', [AiAccountController::class, 'toggle'])->whereNumber('account')->middleware(AuthorizeResource::class.':integrations,update')->name('ai.accounts.toggle');
        Route::post('ai/accounts/{account}/test', [AiAccountController::class, 'test'])->whereNumber('account')->middleware([AuthorizeResource::class.':integrations,update', 'throttle:10,1,ai'])->name('ai.accounts.test');
        Route::delete('ai/accounts/{account}', [AiAccountController::class, 'destroy'])->whereNumber('account')->middleware(AuthorizeResource::class.':integrations,update')->name('ai.accounts.destroy');
        // * Groups the personal Facebook/LinkedIn account joined (read-only Chrome run); sync is 3 per 10 minutes.
        Route::get('{provider}/groups', [SocialGroupController::class, 'index'])->middleware(AuthorizeResource::class.':integrations,view')->name('groups.index');
        Route::post('{provider}/groups/sync', [SocialGroupController::class, 'sync'])->middleware([AuthorizeResource::class.':integrations,update', 'throttle:3,10,social-groups'])->name('groups.sync');
        Route::get('{provider}', [IntegrationController::class, 'show'])->middleware(AuthorizeResource::class.':integrations,view')->name('show');
        Route::put('{provider}', [IntegrationController::class, 'update'])->middleware(AuthorizeResource::class.':integrations,update')->name('update');
        Route::post('{provider}/test', [IntegrationController::class, 'test'])->middleware(AuthorizeResource::class.':integrations,update')->name('test');
        Route::delete('{provider}', [IntegrationController::class, 'destroy'])->middleware(AuthorizeResource::class.':integrations,update')->name('destroy');
    });

    // * Unified inbox: chat conversations and INBOX mail in one list. Each channel keeps its own permission (`conversations.view`, `mail.view`), checked in the controller; replies use the chat/mail routes below. Before the catch-all view route.
    Route::get('inbox', [InboxController::class, 'index'])->name('inbox.index');

    // * Chat: read with `conversations.view`, reply with `conversations.reply`. These routes sit before the catch-all view route.
    Route::prefix('chat')->name('chat.')->group(function () {
        Route::get('/', [ChatController::class, 'index'])->middleware(AuthorizeResource::class.':conversations,view')->name('index');
        Route::get('{conversation}/messages', [ChatController::class, 'messages'])->whereUuid('conversation')->middleware(AuthorizeResource::class.':conversations,view')->name('messages');
        Route::post('{conversation}/messages', [ChatController::class, 'send'])->whereUuid('conversation')->middleware(AuthorizeResource::class.':conversations,reply')->name('send');
        Route::post('{conversation}/attachments', [ChatController::class, 'sendAttachment'])->whereUuid('conversation')->middleware(AuthorizeResource::class.':conversations,reply')->name('send-attachment');
        Route::post('link-preview', ChatLinkPreviewController::class)->middleware([AuthorizeResource::class.':conversations,reply', 'throttle:30,1'])->name('link-preview');
        Route::get('messages/{message}/attachment', [ChatController::class, 'attachment'])->whereNumber('message')->middleware(AuthorizeResource::class.':conversations,view')->name('attachment');
        Route::get('accounts/{account}/avatar', [MessengerAccountController::class, 'avatar'])->whereNumber('account')->middleware(AuthorizeResource::class.':conversations,view')->name('account-avatar');
        Route::get('{conversation}/avatar', [ChatController::class, 'avatar'])->whereUuid('conversation')->middleware(AuthorizeResource::class.':conversations,view')->name('avatar');
        Route::put('{conversation}/pin', [ChatController::class, 'pin'])->whereUuid('conversation')->middleware(AuthorizeResource::class.':conversations,reply')->name('pin');
        Route::post('{conversation}/suggest', [ChatController::class, 'suggest'])->whereUuid('conversation')->middleware([AuthorizeResource::class.':conversations,reply', 'throttle:20,1,ai'])->name('suggest');
        Route::post('messages/{message}/resend', [ChatController::class, 'resend'])->whereNumber('message')->middleware(AuthorizeResource::class.':conversations,reply')->name('resend');
    });

    // * Calendar: event CRUD is the generic items API and `/events/*` pages; `/events` has no list page, so it returns to the calendar.
    Route::get('calendar', [CalendarController::class, 'index'])->middleware(AuthorizeResource::class.':events,view')->name('calendar.index');
    Route::get('calendar/conflicts', [CalendarController::class, 'conflicts'])->middleware(AuthorizeResource::class.':events,view')->name('calendar.conflicts');
    Route::redirect('events', '/calendar');

    // * Social groups table (`integrations.view`); the sync itself is `integrations.groups.sync`. Before the catch-all view route.
    Route::get('social-groups', [SocialGroupController::class, 'manage'])->middleware(AuthorizeResource::class.':integrations,view')->name('social-groups.index');

    // * Posts: dedicated screens (targets, schedule, retry); permissions `posts.{view,create,update,delete,publish}`. Before the catch-all view route.
    Route::prefix('posts')->name('posts.')->group(function () {
        Route::get('/', [PostController::class, 'index'])->middleware(AuthorizeResource::class.':posts,view')->name('index');
        Route::get('create', [PostController::class, 'create'])->middleware(AuthorizeResource::class.':posts,create')->name('create');
        Route::post('/', [PostController::class, 'store'])->middleware(AuthorizeResource::class.':posts,create')->name('store');
        Route::post('targets/{target}/retry', [PostController::class, 'retry'])->whereNumber('target')->middleware(AuthorizeResource::class.':posts,publish')->name('targets.retry');
        Route::get('{post}', [PostController::class, 'edit'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,update')->name('edit');
        Route::put('{post}', [PostController::class, 'update'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,update')->name('update');
        Route::post('{post}/duplicate', [PostController::class, 'duplicate'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,create')->name('duplicate');
        Route::delete('/', [PostController::class, 'destroyMany'])->middleware(AuthorizeResource::class.':posts,delete')->name('destroy-many');
        Route::delete('{post}', [PostController::class, 'destroy'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,delete')->name('destroy');
        Route::post('{post}/publish', [PostController::class, 'publish'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,publish')->name('publish');
        Route::post('{post}/reschedule', [PostController::class, 'reschedule'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,publish')->name('reschedule');
        Route::post('{post}/cancel', [PostController::class, 'cancel'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,publish')->name('cancel');
        Route::post('{post}/dismiss', [PostController::class, 'dismiss'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,update')->name('dismiss');
    });

    // * Jobs: public-page crawl results; permissions `jobs.{view,update}`. Crawling is throttled (6 runs per 10 minutes, its own bucket: an unnamed `throttle:N,M` shares ONE counter per user with every other unnamed throttle). Before the catch-all view route.
    Route::get('jobs', [JobPostingController::class, 'index'])->middleware(AuthorizeResource::class.':jobs,view')->name('jobs.index');
    Route::get('jobs/sources', [JobPostingController::class, 'sourcesPage'])->middleware(AuthorizeResource::class.':jobs,view')->name('jobs.sources');
    Route::patch('jobs/sources/{source}', [JobPostingController::class, 'toggleSource'])->where('source', '[a-z_]+')->middleware(AuthorizeResource::class.':jobs,update')->name('jobs.sources.toggle');
    Route::get('jobs/{jobPosting}', [JobPostingController::class, 'show'])->whereNumber('jobPosting')->middleware(AuthorizeResource::class.':jobs,view')->name('jobs.show');
    Route::post('jobs/crawl', [JobPostingController::class, 'crawl'])->middleware([AuthorizeResource::class.':jobs,update', 'throttle:6,10,jobs-crawl'])->name('jobs.crawl');
    Route::get('cvs/{cv}/file', [CvFileController::class, 'show'])->whereNumber('cv')->middleware(AuthorizeResource::class.':cvs,view')->name('cvs.file');
    Route::post('cvs/{cv}/find-jobs', [JobPostingController::class, 'findForCv'])->whereNumber('cv')->middleware([AuthorizeResource::class.':jobs,update', 'throttle:6,10,jobs-crawl'])->name('cvs.find-jobs');
    Route::patch('jobs/{jobPosting}/status', [JobPostingController::class, 'updateStatus'])->middleware(AuthorizeResource::class.':jobs,update')->name('jobs.status');

    // * Mail: cached IMAP mail with reply over each mailbox's own SMTP; reads `mail.view`, replies `mail.send`. Mailbox management (`/mail/accounts`) uses `integrations.{view,update}`.
    // * Network actions are throttled (own bucket each, so they never eat each other's allowance): connection test 5 per 10 minutes, sync-now 3 per 5, replies 20 per minute, resends 10 per minute. Before the catch-all view route.
    Route::prefix('mail')->name('mail.')->group(function () {
        Route::get('/', [MailController::class, 'index'])->middleware(AuthorizeResource::class.':mail,view')->name('index');
        Route::get('messages/{message}', [MailController::class, 'show'])->whereNumber('message')->middleware(AuthorizeResource::class.':mail,view')->name('show');
        Route::post('messages/{message}/unread', [MailController::class, 'markUnread'])->whereNumber('message')->middleware(AuthorizeResource::class.':mail,view')->name('unread');
        Route::post('messages/{message}/reply', [MailController::class, 'reply'])->whereNumber('message')->middleware([AuthorizeResource::class.':mail,send', 'throttle:20,1,mail-reply'])->name('reply');
        Route::post('outbox/{outbox}/resend', [MailController::class, 'resend'])->whereNumber('outbox')->middleware([AuthorizeResource::class.':mail,send', 'throttle:10,1,mail-resend'])->name('resend');

        Route::prefix('accounts')->name('accounts.')->group(function () {
            Route::get('/', [MailboxController::class, 'index'])->middleware(AuthorizeResource::class.':integrations,view')->name('index');
            Route::get('create', [MailboxController::class, 'create'])->middleware(AuthorizeResource::class.':integrations,update')->name('create');
            Route::post('/', [MailboxController::class, 'store'])->middleware(AuthorizeResource::class.':integrations,update')->name('store');
            Route::post('test', [MailboxController::class, 'test'])->middleware([AuthorizeResource::class.':integrations,update', 'throttle:5,10,mail-test'])->name('test');
            Route::get('{mailbox}/edit', [MailboxController::class, 'edit'])->whereNumber('mailbox')->middleware(AuthorizeResource::class.':integrations,update')->name('edit');
            Route::put('{mailbox}', [MailboxController::class, 'update'])->whereNumber('mailbox')->middleware(AuthorizeResource::class.':integrations,update')->name('update');
            Route::delete('{mailbox}', [MailboxController::class, 'destroy'])->whereNumber('mailbox')->middleware(AuthorizeResource::class.':integrations,update')->name('destroy');
            Route::post('{mailbox}/sync', [MailboxController::class, 'sync'])->whereNumber('mailbox')->middleware([AuthorizeResource::class.':integrations,update', 'throttle:3,5,mail-sync'])->name('sync');
        });
    });

    // * AI assistant: drafts and answers (only `auto-reply` turns on automatic customer replies, see AutoReplyJob); permission `ai.use`, throttled because every call costs money. Before the catch-all view route.
    Route::prefix('ai')->name('ai.')->middleware([AuthorizeResource::class.':ai,use', 'throttle:20,1,ai'])->group(function () {
        Route::post('ask', [AiController::class, 'ask'])->name('ask');
        Route::post('cv-latex', [AiController::class, 'cvLatex'])->name('cv-latex');
        Route::post('cv-extract', [AiController::class, 'extractCv'])->name('cv-extract');
        Route::post('post-draft', [AiController::class, 'postDraft'])->name('post-draft');
        Route::post('auto-reply', [AiController::class, 'autoReply'])->name('auto-reply');
    });

    // * Tasks goes through the generic items API and view routes below.

    // * Admins
    Route::get('admins', [AdminController::class, 'index'])->name('admins.index');
    Route::get('admins/create', [AdminController::class, 'create'])->name('admins.create');
    Route::post('admins', [AdminController::class, 'store'])->name('admins.store');
    Route::post('admins/bulk-destroy', [AdminController::class, 'bulkDestroy'])->name('admins.bulk-destroy');
    Route::post('admins/bulk-duplicate', [AdminController::class, 'bulkDuplicate'])->name('admins.bulk-duplicate');
    Route::get('admins/export', [AdminController::class, 'export'])->name('admins.export');
    Route::post('admins/import', [AdminController::class, 'import'])->name('admins.import');
    Route::get('admins/trash', [AdminController::class, 'trash'])->name('admins.trash');
    Route::post('admins/trash/{admin}/restore', [AdminController::class, 'restore'])->name('admins.trash.restore');
    Route::delete('admins/trash/{admin}', [AdminController::class, 'forceDelete'])->name('admins.trash.forceDelete');
    Route::get('admins/{admin}', [AdminController::class, 'edit'])->name('admins.edit');
    Route::put('admins/{admin}', [AdminController::class, 'update'])->name('admins.update');
    Route::delete('admins/{admin}', [AdminController::class, 'destroy'])->name('admins.destroy');

    // * Roles & permissions
    Route::get('roles', [RoleController::class, 'index'])->name('roles.index');
    Route::post('roles', [RoleController::class, 'store'])->name('roles.store');
    Route::get('roles/permissions-catalog', [RoleController::class, 'permissionsCatalog'])->name('roles.permissions-catalog');
    Route::get('roles/{role}/permissions-data', [RoleController::class, 'permissionsData'])->name('roles.permissions-data');
    Route::put('roles/{role}/permissions', [RoleController::class, 'updatePermissions'])->name('roles.permissions.update');
    Route::put('roles/{role}', [RoleController::class, 'update'])->name('roles.update');
    Route::delete('roles/{role}', [RoleController::class, 'destroy'])->name('roles.destroy');

    // * File manager
    Route::get('file-manager', [FileController::class, 'index'])->name('files.index');
    Route::get('file-manager/trash', [FileController::class, 'trash'])->name('files.trash');
    Route::get('file-manager/picker', [FileController::class, 'picker'])->name('files.picker');
    Route::delete('file-manager/cache', [FileController::class, 'clearCache'])->name('files.cache.clear');
    Route::post('file-manager', [FileController::class, 'store'])->name('files.store');
    Route::post('file-manager/folders', [FileController::class, 'storeFolder'])->name('files.folders.store');
    Route::get('file-manager/{id}/thumbnail', [FileController::class, 'thumbnail'])->name('files.thumbnail');
    Route::get('file-manager/{id}/download', [FileController::class, 'download'])->name('files.download');
    Route::get('file-manager/download-zip', [FileController::class, 'downloadZip'])->name('files.download-zip');
    Route::get('file-manager/tree', [FileController::class, 'folderTree'])->name('files.tree');
    Route::get('file-manager/{id}/permissions', [FileController::class, 'permissions'])->name('files.permissions');
    Route::post('file-manager/{id}/permissions', [FileController::class, 'updatePermissions'])->name('files.permissions.update');
    Route::post('file-manager/move', [FileController::class, 'move'])->name('files.move');
    Route::post('file-manager/duplicate', [FileController::class, 'duplicate'])->name('files.duplicate');
    Route::post('file-manager/compress', [FileController::class, 'compress'])->name('files.compress');
    Route::post('file-manager/{id}/extract', [FileController::class, 'extract'])->name('files.extract');
    Route::post('file-manager/{id}/restore', [FileController::class, 'restore'])->name('files.restore');
    Route::patch('file-manager/{file}', [FileController::class, 'update'])->name('files.update');
    Route::delete('file-manager/{file}', [FileController::class, 'destroy'])->name('files.destroy');
    Route::post('file-manager/bulk-destroy', [FileController::class, 'bulkDestroy'])->name('files.bulk-destroy');
    Route::delete('file-manager/{id}/force', [FileController::class, 'forceDestroy'])->name('files.force-destroy');
});

// * Generic headless content API — any App\Models\* model using the QueryBuilder concern is addressable here.
Route::middleware(['web', 'auth', AuthorizeResource::class])->get('source/{resource}/{field?}', [ItemController::class, 'source'])->name('items.source');

Route::middleware(['web', 'auth', AuthorizeResource::class])->prefix('items')->group(function () {
    Route::get('{resource}/export', [ItemController::class, 'export'])->name('items.export');
    Route::post('{resource}/import', [ItemController::class, 'import'])->name('items.import');
    Route::post('{resource}/dashboards', [ItemController::class, 'dashboards'])->name('items.dashboards');
    Route::get('{resource}/options/{field}', [ItemController::class, 'options'])->name('items.options');

    Route::get('{resource}/{id}/frontend-url', [ItemController::class, 'frontendUrl'])->name('items.frontend-url');
    Route::get('{resource}/{id}/index-status', [ItemController::class, 'indexStatus'])->name('items.index-status');
    Route::post('{resource}/{id}/restore', [ItemController::class, 'restore'])->name('items.restore');
    Route::delete('{resource}/{id}/force', [ItemController::class, 'forceDestroy'])->name('items.force-destroy');

    Route::get('{resource}', [ItemController::class, 'index'])->name('items.index');
    Route::post('{resource}', [ItemController::class, 'store'])->name('items.store');
    Route::get('{resource}/{idOrSlug}', [ItemController::class, 'show'])->name('items.show');
    Route::put('{resource}/{id}', [ItemController::class, 'update'])->name('items.update');
    Route::delete('{resource}/{id}', [ItemController::class, 'destroy'])->name('items.destroy');
});

Route::middleware(['api', 'auth', AuthorizeResource::class])->prefix('api/items')->group(function () {
    Route::get('{resource}', [ItemController::class, 'index'])->name('api.items.index');
    Route::post('{resource}', [ItemController::class, 'store'])->name('api.items.store');
    Route::get('{resource}/{idOrSlug}', [ItemController::class, 'show'])->name('api.items.show');
    Route::put('{resource}/{id}', [ItemController::class, 'update'])->name('api.items.update');
    Route::delete('{resource}/{id}', [ItemController::class, 'destroy'])->name('api.items.destroy');
});

// * Catch-all last: any App\Models\* resource gets a generic admin page without extra routing.
Route::middleware(['auth', 'web', AuthorizeResource::class])->get('{collection}/{slug?}', [ViewController::class, 'handler'])
    ->where('collection', '[^/]+')
    ->name('view.page');
