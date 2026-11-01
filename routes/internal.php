<?php

use App\Http\Controllers\ZaloBridgeController;
use Illuminate\Support\Facades\Route;

// * Loaded by `bootstrap/app.php` under `internal/zalo` with signature + throttle middleware only: no session, cookies or CSRF.
Route::post('session', [ZaloBridgeController::class, 'storeSession'])->name('session.store');
Route::get('session', [ZaloBridgeController::class, 'showSession'])->name('session.show');
Route::get('accounts', [ZaloBridgeController::class, 'accounts'])->name('accounts');
Route::post('status', [ZaloBridgeController::class, 'status'])->name('status');
Route::post('inbound', [ZaloBridgeController::class, 'inbound'])->name('inbound');
