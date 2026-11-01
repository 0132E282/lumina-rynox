<?php

declare(strict_types=1);

namespace App\Services\Integrations;

use App\Models\Integration;

interface IntegrationProvider
{
    public function key(): string;

    /**
     * Stores the validated input and marks the integration connected. A secret left out of `secrets` keeps its stored value.
     *
     * @param  array{fields: array<string, ?string>, secrets: array<string, string>, permissions: list<string>, risk_acknowledged: bool}  $input
     */
    public function connect(array $input): Integration;

    /** * A real connection check, or `ConnectionTestResult::unsupported()`; never a fake pass. */
    public function test(): ConnectionTestResult;

    /** * Removes the credentials and marks the integration disconnected. */
    public function disconnect(): Integration;

    /** * One of the `Integration::STATUS_*` values; `disconnected` when nothing is stored. */
    public function status(): string;
}
