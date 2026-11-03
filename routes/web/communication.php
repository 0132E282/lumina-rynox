<?php

declare(strict_types=1);

use App\Http\Controllers\CalendarController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ChatLinkPreviewController;
use App\Http\Controllers\InboxController;
use App\Http\Controllers\MessengerAccountController;
use App\Http\Controllers\SocialGroupController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

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
