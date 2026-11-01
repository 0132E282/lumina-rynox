<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Laravel\Fortify\Contracts\PasswordConfirmedResponse as PasswordConfirmedResponseContract;

class CmsPasswordConfirmedResponse implements PasswordConfirmedResponseContract
{
    /** * Stays on the page that asked for confirmation instead of Fortify's `redirect()->intended()`. */
    public function toResponse($request): JsonResponse|RedirectResponse
    {
        return $request->wantsJson()
            ? new JsonResponse('', 201)
            : back();
    }
}
