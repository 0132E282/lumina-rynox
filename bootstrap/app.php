<?php

use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\VerifyZaloBridgeSignature;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
        // * Zalo sidecar callbacks: outside the web group (no session/CSRF/cookies), authenticated by HMAC from loopback only.
        then: function (): void {
            Route::middleware([VerifyZaloBridgeSignature::class, 'throttle:600,1'])
                ->prefix('internal/zalo')
                ->name('internal.zalo.')
                ->group(base_path('routes/internal.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->encryptCookies(except: ['appearance', 'sidebar_state']);
        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*', 'internal/*') || $request->expectsJson(),
        );
        // * Facebook cookies (Messenger sign-in `cookies`, personal posting `secrets.cookies`) are login credentials: never flash them to the session.
        $exceptions->dontFlash(['cookies', 'secrets']);
    })->create();

return $app;
