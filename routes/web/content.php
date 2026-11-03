<?php

declare(strict_types=1);

use App\Http\Controllers\ItemController;
use App\Http\Controllers\ViewController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

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
