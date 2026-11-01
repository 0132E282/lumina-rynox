<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Chat\Zalo\BridgeSignature;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** * Guards `/internal/zalo/*`: loopback caller only, a configured secret, a fresh timestamp and a valid HMAC over the raw request. */
class VerifyZaloBridgeSignature
{
    private const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'];

    public function handle(Request $request, Closure $next): Response
    {
        if (! in_array($request->ip(), self::LOOPBACK_ADDRESSES, true)) {
            abort(403);
        }

        $secret = (string) config('services.zalo_bridge.secret');

        if ($secret === '') {
            abort(503, 'Zalo bridge chưa được cấu hình.');
        }

        $valid = BridgeSignature::verify(
            $secret,
            (string) $request->header('X-Bridge-Timestamp'),
            (string) $request->header('X-Bridge-Signature'),
            $request->method(),
            $request->getRequestUri(),
            $request->getContent(),
        );

        abort_unless($valid, 401);

        return $next($request);
    }
}
