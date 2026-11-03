<?php

declare(strict_types=1);

use App\Http\Controllers\AiController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

// * AI assistant: drafts and answers (only `auto-reply` turns on automatic customer replies, see AutoReplyJob); permission `ai.use`, throttled because every call costs money. Before the catch-all view route.
Route::prefix('ai')->name('ai.')->middleware([AuthorizeResource::class.':ai,use', 'throttle:20,1,ai'])->group(function () {
    Route::post('ask', [AiController::class, 'ask'])->name('ask');
    Route::post('cv-latex', [AiController::class, 'cvLatex'])->name('cv-latex');
    Route::post('cv-extract', [AiController::class, 'extractCv'])->name('cv-extract');
    Route::post('post-draft', [AiController::class, 'postDraft'])->name('post-draft');
    Route::post('auto-reply', [AiController::class, 'autoReply'])->name('auto-reply');
});
