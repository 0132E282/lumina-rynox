<?php

declare(strict_types=1);

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

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
