<?php

declare(strict_types=1);

namespace App\Services\Mail;

use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * Server-side layer of the HTML-mail defence. Layers 2 and 3 (sandboxed iframe without scripts, CSP in srcdoc) live in the
 * browser. The only HTML that may be stored in `mail_messages.body_html` is what this class returns.
 *
 * Remote images are kept as https URLs on purpose: the iframe CSP blocks them until the user presses "Hiện ảnh". `http`
 * images are dropped (not upgraded) so nothing is ever fetched over plain text.
 */
final class HtmlBodySanitizer
{
    // * Everything that can run code, load another document, submit data or change the page's base/refresh.
    private const FORBIDDEN_ELEMENTS = [
        'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select',
        'textarea', 'option', 'meta', 'link', 'base', 'svg', 'math', 'noscript', 'template', 'audio', 'video', 'source',
        'track', 'canvas', 'dialog',
    ];

    private ?HtmlSanitizer $sanitizer = null;

    public function sanitize(string $html): string
    {
        return $this->sanitizer()->sanitizeFor('body', $html);
    }

    private function sanitizer(): HtmlSanitizer
    {
        if ($this->sanitizer !== null) {
            return $this->sanitizer;
        }

        $config = (new HtmlSanitizerConfig)
            ->allowSafeElements()
            ->allowLinkSchemes(['https', 'http', 'mailto'])
            ->allowMediaSchemes(['https', 'data'])
            ->allowRelativeLinks(false)
            ->allowRelativeMedias(false)
            ->forceAttribute('a', 'rel', 'noopener noreferrer')
            ->forceAttribute('a', 'target', '_blank')
            // * Newsletters need inline styling; the CSP in the iframe stops `url()` loads and nothing here can run script.
            ->allowAttribute('style', '*')
            ->withMaxInputLength(max((int) config('mailbox.body_max_bytes'), 1024) + 1024);

        foreach (self::FORBIDDEN_ELEMENTS as $element) {
            $config = $config->dropElement($element);
        }

        return $this->sanitizer = new HtmlSanitizer($config);
    }
}
