<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;

class CmsLoginResponse implements LoginResponseContract
{
    public function toResponse($request)
    {
        // ! Not `redirect()->intended()`: background requests (service workers) can hijack the intended URL.
        return redirect()->to(config('fortify.home', '/'));
    }
}
