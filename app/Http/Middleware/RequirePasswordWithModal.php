<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Auth\Middleware\RequirePassword;
use Illuminate\Http\JsonResponse;

class RequirePasswordWithModal extends RequirePassword
{
    public function handle($request, Closure $next, $redirectToRoute = null, $passwordTimeoutSeconds = null)
    {
        if ($request->header('X-Inertia') === 'true' && $this->shouldConfirmPassword($request, $passwordTimeoutSeconds)) {
            return new JsonResponse(
                ['message' => 'Password confirmation required.'],
                423,
                [
                    'X-Inertia' => 'true',
                    'X-Password-Confirmation' => 'required',
                ],
            );
        }

        return parent::handle($request, $next, $redirectToRoute, $passwordTimeoutSeconds);
    }
}
