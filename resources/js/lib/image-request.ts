// * Whole words only (letters on both sides do not count), Vietnamese and English; a hint for the status line, nothing more.
const IMAGE_WORDS =
    /(^|[^\p{L}])(ảnh|hình|hình ảnh|tạo ảnh|vẽ|image|picture|photo|draw|drawing|logo|svg|illustration)([^\p{L}]|$)/iu;

/** * True when the message looks like a request for a picture. */
export function asksForImage(message: string): boolean {
    return IMAGE_WORDS.test(message);
}
