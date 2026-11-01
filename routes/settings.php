<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\Settings\GeneralSettingsController;
use App\Http\Controllers\Settings\GoogleAnalyticsSettingsController;
use App\Http\Controllers\Settings\ProfileController;
use App\Http\Controllers\Settings\SearchConsoleSettingsController;
use App\Http\Controllers\Settings\SecurityController;
use App\Http\Controllers\Settings\SmtpSettingsController;
use App\Http\Middleware\RequirePasswordWithModal;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth'])->group(function () {
    Route::redirect('settings', '/settings/profile');

    Route::get('settings/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('settings/profile', [ProfileController::class, 'update'])->name('profile.update');

    Route::get('settings/general', [GeneralSettingsController::class, 'edit'])->name('general.edit');
    Route::patch('settings/general', [GeneralSettingsController::class, 'update'])->name('general.update');

    Route::get('settings/smtp', [SmtpSettingsController::class, 'edit'])->name('smtp.edit');
    Route::patch('settings/smtp', [SmtpSettingsController::class, 'update'])->name('smtp.update');

    Route::get('settings/search-console', [SearchConsoleSettingsController::class, 'edit'])->name('search-console.edit');
    Route::patch('settings/search-console', [SearchConsoleSettingsController::class, 'update'])->name('search-console.update');

    Route::get('settings/google-analytics', [GoogleAnalyticsSettingsController::class, 'edit'])->name('google-analytics.edit');
    Route::patch('settings/google-analytics', [GoogleAnalyticsSettingsController::class, 'update'])->name('google-analytics.update');

    Route::get('account/status', [AccountController::class, 'check'])->name('account.status');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::delete('settings/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    Route::get('settings/security', [SecurityController::class, 'edit'])
        ->middleware(RequirePasswordWithModal::class)
        ->name('security.edit');

    Route::put('settings/password', [SecurityController::class, 'update'])
        ->middleware('throttle:6,1')
        ->name('user-password.update');

    Route::inertia('settings/appearance', 'settings/appearance')->name('appearance.edit');
});

Route::get('.well-known/passkey-endpoints', function () {
    return response()->json([
        'enroll' => route('security.edit'),
        'manage' => route('security.edit'),
    ]);
})->name('well-known.passkeys');
