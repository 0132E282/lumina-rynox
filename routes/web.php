<?php

declare(strict_types=1);

use App\Http\Controllers\AiChatController;
use App\Http\Controllers\DashboardController;
use Illuminate\Support\Facades\Route;

require __DIR__.'/settings.php';

// * Routes are split by area under routes/web/. The ORDER of the requires is the order routes match: the generic items API and the catch-all page route (content.php) must stay last.
Route::middleware(['auth', 'web'])->group(function () {
    // * `/` is the AI chat home (permission `ai.use`; without it the controller sends the person to the dashboard). The dashboard moved to `/dashboard`.
    Route::get('/', [AiChatController::class, 'index'])->name('home');
    Route::get('dashboard', [DashboardController::class, 'index'])->name('dashboard');

    require __DIR__.'/web/ai-chat.php';
    require __DIR__.'/web/system.php';
    require __DIR__.'/web/integrations.php';
    require __DIR__.'/web/communication.php';
    require __DIR__.'/web/publishing.php';
    require __DIR__.'/web/mail.php';
    require __DIR__.'/web/ai-assistant.php';
    require __DIR__.'/web/administration.php';
    require __DIR__.'/web/files.php';
});

require __DIR__.'/web/content.php';
