<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\ResourceResolver;
use App\Support\RuleSchemaConverter;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Inertia\Inertia;

class ViewController extends Controller
{
    public function handler(Request $request, string $collection, ?string $slug = null)
    {
        // * Any segment other than "create" is an id or slug, so slug-based URLs open the edit form.
        return match (true) {
            $slug === 'create' => Inertia::render("{$collection}/form", $this->formProps($collection)),
            filled($slug) => Inertia::render("{$collection}/form", ['id' => $slug, ...$this->formProps($collection)]),
            default => Inertia::render("{$collection}/index"),
        };
    }

    /**
     * * Field constraints from the DB schema merged with `rules()` (rules win), shared as a page prop
     * * so the form's Zod schema is derived without repeating `validate="..."` on each `<Field>`.
     */
    protected function formProps(string $collection): array
    {
        $modelClass = ResourceResolver::resolve($collection);

        if (! $modelClass) {
            return [];
        }

        return ['schema' => RuleSchemaConverter::forModel($modelClass)];
    }
}
