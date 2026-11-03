<?php

declare(strict_types=1);

use App\Http\Controllers\MailboxController;
use App\Http\Controllers\MailController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

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
