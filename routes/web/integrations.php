<?php

declare(strict_types=1);

use App\Http\Controllers\AiAccountController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\LinkedInOAuthController;
use App\Http\Controllers\MessengerAccountController;
use App\Http\Controllers\MessengerLoginController;
use App\Http\Controllers\SocialGroupController;
use App\Http\Controllers\ZaloAccountController;
use App\Http\Controllers\ZaloContactsController;
use App\Http\Controllers\ZaloLoginController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

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
    // * Same sign-in, but the cookies come from the Facebook already logged in this machine's Chrome (nothing pasted).
    Route::post('messenger/login/browser', [MessengerLoginController::class, 'loginFromBrowser'])->middleware([AuthorizeResource::class.':integrations,update', 'throttle:3,10'])->name('messenger.login.browser');
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
