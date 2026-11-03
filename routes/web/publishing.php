<?php

declare(strict_types=1);

use App\Http\Controllers\CvFileController;
use App\Http\Controllers\JobPostingController;
use App\Http\Controllers\PostController;
use App\Http\Middleware\AuthorizeResource;
use Illuminate\Support\Facades\Route;

// * Posts: dedicated screens (targets, schedule, retry); permissions `posts.{view,create,update,delete,publish}`. Before the catch-all view route.
Route::prefix('posts')->name('posts.')->group(function () {
    Route::get('/', [PostController::class, 'index'])->middleware(AuthorizeResource::class.':posts,view')->name('index');
    Route::get('create', [PostController::class, 'create'])->middleware(AuthorizeResource::class.':posts,create')->name('create');
    Route::post('/', [PostController::class, 'store'])->middleware(AuthorizeResource::class.':posts,create')->name('store');
    Route::post('targets/{target}/retry', [PostController::class, 'retry'])->whereNumber('target')->middleware(AuthorizeResource::class.':posts,publish')->name('targets.retry');
    Route::get('{post}', [PostController::class, 'edit'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,update')->name('edit');
    Route::put('{post}', [PostController::class, 'update'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,update')->name('update');
    Route::post('{post}/duplicate', [PostController::class, 'duplicate'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,create')->name('duplicate');
    Route::delete('/', [PostController::class, 'destroyMany'])->middleware(AuthorizeResource::class.':posts,delete')->name('destroy-many');
    Route::delete('{post}', [PostController::class, 'destroy'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,delete')->name('destroy');
    Route::post('{post}/publish', [PostController::class, 'publish'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,publish')->name('publish');
    Route::post('{post}/reschedule', [PostController::class, 'reschedule'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,publish')->name('reschedule');
    Route::post('{post}/cancel', [PostController::class, 'cancel'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,publish')->name('cancel');
    Route::post('{post}/dismiss', [PostController::class, 'dismiss'])->whereNumber('post')->middleware(AuthorizeResource::class.':posts,update')->name('dismiss');
});

// * Jobs: public-page crawl results; permissions `jobs.{view,update}`. Crawling is throttled (6 runs per 10 minutes, its own bucket: an unnamed `throttle:N,M` shares ONE counter per user with every other unnamed throttle). Before the catch-all view route.
Route::get('jobs', [JobPostingController::class, 'index'])->middleware(AuthorizeResource::class.':jobs,view')->name('jobs.index');
Route::get('jobs/sources', [JobPostingController::class, 'sourcesPage'])->middleware(AuthorizeResource::class.':jobs,view')->name('jobs.sources');
Route::patch('jobs/sources/{source}', [JobPostingController::class, 'toggleSource'])->where('source', '[a-z_]+')->middleware(AuthorizeResource::class.':jobs,update')->name('jobs.sources.toggle');
Route::get('jobs/{jobPosting}', [JobPostingController::class, 'show'])->whereNumber('jobPosting')->middleware(AuthorizeResource::class.':jobs,view')->name('jobs.show');
Route::post('jobs/crawl', [JobPostingController::class, 'crawl'])->middleware([AuthorizeResource::class.':jobs,update', 'throttle:6,10,jobs-crawl'])->name('jobs.crawl');
Route::get('cvs/{cv}/file', [CvFileController::class, 'show'])->whereNumber('cv')->middleware(AuthorizeResource::class.':cvs,view')->name('cvs.file');
Route::post('cvs/{cv}/find-jobs', [JobPostingController::class, 'findForCv'])->whereNumber('cv')->middleware([AuthorizeResource::class.':jobs,update', 'throttle:6,10,jobs-crawl'])->name('cvs.find-jobs');
Route::patch('jobs/{jobPosting}/status', [JobPostingController::class, 'updateStatus'])->middleware(AuthorizeResource::class.':jobs,update')->name('jobs.status');
