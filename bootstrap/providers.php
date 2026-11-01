<?php

use App\Providers\AppServiceProvider;
use App\Providers\CmsServiceProvider;
use App\Providers\FortifyServiceProvider;

return [
    AppServiceProvider::class,
    FortifyServiceProvider::class,
    CmsServiceProvider::class,
];
