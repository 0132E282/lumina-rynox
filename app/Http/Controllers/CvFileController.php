<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Cv;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CvFileController extends Controller
{
    /** * The CV file kept from the upload (permission `cvs.view`, route middleware). The download name is the CV's name, never the stored path. */
    public function show(Cv $cv): StreamedResponse
    {
        abort_unless($cv->file_path !== null && Storage::exists($cv->file_path), 404);

        return Storage::download($cv->file_path, str($cv->name)->slug()->append('.'.pathinfo($cv->file_path, PATHINFO_EXTENSION))->toString());
    }
}
