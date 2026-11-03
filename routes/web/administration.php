<?php

declare(strict_types=1);

use App\Http\Controllers\AdminController;
use App\Http\Controllers\RoleController;
use Illuminate\Support\Facades\Route;

// * Admins
Route::get('admins', [AdminController::class, 'index'])->name('admins.index');
Route::get('admins/create', [AdminController::class, 'create'])->name('admins.create');
Route::post('admins', [AdminController::class, 'store'])->name('admins.store');
Route::post('admins/bulk-destroy', [AdminController::class, 'bulkDestroy'])->name('admins.bulk-destroy');
Route::post('admins/bulk-duplicate', [AdminController::class, 'bulkDuplicate'])->name('admins.bulk-duplicate');
Route::get('admins/export', [AdminController::class, 'export'])->name('admins.export');
Route::post('admins/import', [AdminController::class, 'import'])->name('admins.import');
Route::get('admins/trash', [AdminController::class, 'trash'])->name('admins.trash');
Route::post('admins/trash/{admin}/restore', [AdminController::class, 'restore'])->name('admins.trash.restore');
Route::delete('admins/trash/{admin}', [AdminController::class, 'forceDelete'])->name('admins.trash.forceDelete');
Route::get('admins/{admin}', [AdminController::class, 'edit'])->name('admins.edit');
Route::put('admins/{admin}', [AdminController::class, 'update'])->name('admins.update');
Route::delete('admins/{admin}', [AdminController::class, 'destroy'])->name('admins.destroy');

// * Roles & permissions
Route::get('roles', [RoleController::class, 'index'])->name('roles.index');
Route::post('roles', [RoleController::class, 'store'])->name('roles.store');
Route::get('roles/permissions-catalog', [RoleController::class, 'permissionsCatalog'])->name('roles.permissions-catalog');
Route::get('roles/{role}/permissions-data', [RoleController::class, 'permissionsData'])->name('roles.permissions-data');
Route::put('roles/{role}/permissions', [RoleController::class, 'updatePermissions'])->name('roles.permissions.update');
Route::put('roles/{role}', [RoleController::class, 'update'])->name('roles.update');
Route::delete('roles/{role}', [RoleController::class, 'destroy'])->name('roles.destroy');
