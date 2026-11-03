const word = (pattern: string) =>
    new RegExp(`(^|[^\\p{L}])(${pattern})([^\\p{L}]|$)`, 'iu');

// * Whole words only (letters on both sides do not count), Vietnamese and English; a hint for the status line, nothing more.
const IMAGE_WORDS = word(
    'ảnh|hình|hình ảnh|image|picture|photo|logo|svg|illustration',
);
const DRAW_WORDS = word('vẽ|draw|drawing');
const MAKE_WORDS = word(
    'tạo|làm|thiết kế|sinh|generate|create|make|design|render',
);
// * "Can you make images?", "có tạo được ảnh không": a question about the ability, not a request.
const ABILITY_QUESTION =
    /(có|biết|được|thể)[^?]*không\s*\??\s*$|\b(can|could|are you able|do you)\b[^.]*\?/iu;

/** * True when the message asks for a picture to be made (a question about whether that is possible does not count). */
export function asksForImage(message: string): boolean {
    const asked =
        DRAW_WORDS.test(message) ||
        (IMAGE_WORDS.test(message) && MAKE_WORDS.test(message));

    return asked && !ABILITY_QUESTION.test(message.trim());
}
