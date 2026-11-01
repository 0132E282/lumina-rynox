<?php

declare(strict_types=1);

namespace App\Support;

use Carbon\CarbonImmutable;

/** * "Today" for the Personal Manager modules, in `cms.personal_timezone` rather than the UTC app timezone. */
final class PersonalClock
{
    public static function today(): CarbonImmutable
    {
        return CarbonImmutable::now(config('cms.personal_timezone'))->startOfDay();
    }
}
