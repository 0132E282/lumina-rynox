<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use App\Models\Cv;
use App\Models\JobPosting;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;

/**
 * Keeps the LaTeX version of a CV up to date after its jobs were scored: the AI rewrites the CV, tuned to the well-matching jobs, and the
 * text is saved in `cvs.latex`. It never touches `content`, and it only overwrites a LaTeX text the person did not edit by hand
 * (empty, or still exactly what the AI wrote last time, tracked by `latex_hash`).
 */
class CvLatexWriter
{
    public function __construct(private readonly AiAssistant $ai) {}

    /** @return bool whether a new LaTeX text was saved */
    public function refresh(Cv $cv): bool
    {
        $content = trim((string) $cv->content);
        $edited = $cv->latex !== null && $cv->latex !== '' && sha1($cv->latex) !== $cv->latex_hash;

        if ($content === '' || $edited) {
            return false;
        }

        try {
            $latex = $this->ai->cvLatex($content, $this->jobsContext($cv));
        } catch (AiException) {
            return false;
        }

        if ($latex === null) {
            return false;
        }

        $cv->forceFill(['latex' => $latex, 'latex_hash' => sha1($latex)])->save();

        return true;
    }

    /** Title and requirements of the best-matching recent jobs scored against this CV. */
    private function jobsContext(Cv $cv): string
    {
        return JobPosting::query()
            ->where('meta->matched_cv_id', $cv->id)
            ->where('meta->match_score', '>=', (int) config('jobs.match.threshold'))
            ->orderByDesc('id')
            ->limit(5)
            ->get()
            ->map(fn (JobPosting $job): string => '- '.$job->title.($job->meta['requirements'] ?? null ? ': '.str_replace("\n", ' ', (string) $job->meta['requirements']) : ''))
            ->implode("\n");
    }
}
