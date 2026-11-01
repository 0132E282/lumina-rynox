<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Chat\LinkPreview;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ChatLinkPreviewController extends Controller
{
    /** * Link card for the address being typed in the composer; `null` when the page offers nothing to show. */
    public function __invoke(Request $request, LinkPreview $preview): JsonResponse
    {
        $data = $request->validate(['url' => ['required', 'string', 'max:2048', 'url:http,https']]);

        return response()->json(['preview' => $preview->fetch($data['url'])]);
    }
}
