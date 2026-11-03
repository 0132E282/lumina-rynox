<?php

declare(strict_types=1);

use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\ApiKeyController;
use App\Http\Controllers\AppPasswordController;
use App\Http\Controllers\SystemController;
use Illuminate\Support\Facades\Route;

Route::get('system', [SystemController::class, 'index'])->name('system.index');
Route::get('activity-logs', [ActivityLogController::class, 'index'])->name('activity-logs.index');

Route::get('api-keys', [ApiKeyController::class, 'index'])->name('api-keys.index');
Route::post('api-keys', [ApiKeyController::class, 'store'])->name('api-keys.store');
Route::post('api-keys/{id}/revoke', [ApiKeyController::class, 'revoke'])->name('api-keys.revoke');
Route::delete('api-keys/{id}', [ApiKeyController::class, 'destroy'])->name('api-keys.destroy');

Route::get('app-password/status', [AppPasswordController::class, 'status'])->name('app-password.status');
Route::post('app-password/confirm', [AppPasswordController::class, 'confirm'])->name('app-password.confirm');
