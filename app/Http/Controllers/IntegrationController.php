<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\UpdateIntegrationRequest;
use App\Models\Integration;
use App\Services\Integrations\IntegrationManager;
use App\Services\Integrations\IntegrationProvider;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

// ! No method here may log or return `credentials`; the page only receives `IntegrationManager::present()` data.
class IntegrationController extends Controller
{
    public function __construct(private readonly IntegrationManager $integrations) {}

    public function index(): Response
    {
        return Inertia::render('integrations/index', ['groups' => $this->integrations->overview()]);
    }

    public function show(string $provider): Response|RedirectResponse
    {
        $definition = $this->integrations->definition($provider) ?? abort(404);

        // * Providers with their own management screen (email) have no generic form.
        if (isset($definition['manage_url'])) {
            return redirect($definition['manage_url']);
        }

        return Inertia::render($definition['page'] ?? 'integrations/show', [
            'integration' => $this->integrations->present(
                $provider,
                $definition,
                Integration::query()->where('provider', $provider)->first(),
            ),
        ]);
    }

    public function update(UpdateIntegrationRequest $request, string $provider): RedirectResponse
    {
        $this->resolve($provider)->connect($request->connectionInput());

        return $this->back($provider, 'success', 'Đã lưu kết nối.');
    }

    public function test(string $provider): RedirectResponse
    {
        $result = $this->resolve($provider)->test();

        $type = match (true) {
            ! $result->supported => 'info',
            $result->ok => 'success',
            default => 'error',
        };

        return $this->back($provider, $type, $result->message);
    }

    public function destroy(string $provider): RedirectResponse
    {
        $this->resolve($provider)->disconnect();

        return $this->back($provider, 'success', 'Đã ngắt kết nối.');
    }

    private function resolve(string $provider): IntegrationProvider
    {
        return $this->integrations->provider($provider) ?? abort(404);
    }

    private function back(string $provider, string $type, string $message): RedirectResponse
    {
        Inertia::flash('toast', ['type' => $type, 'message' => $message]);

        $manageUrl = $this->integrations->definition($provider)['manage_url'] ?? null;

        return $manageUrl !== null ? redirect($manageUrl) : to_route('integrations.show', ['provider' => $provider]);
    }
}
