/** * Longest side (px) of the avatar sent to the server: small enough to stay far below any PHP upload limit. */
export const AVATAR_UPLOAD_SIDE = 512;
/** * Largest original file the browser tries to decode; only protects the browser from hanging. */
export const AVATAR_MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** * Centre square of the source and the size it is drawn at (never enlarged). */
export function squareCrop(
    width: number,
    height: number,
    maxSide: number = AVATAR_UPLOAD_SIDE,
) {
    const side = Math.min(width, height);

    return {
        sourceX: Math.floor((width - side) / 2),
        sourceY: Math.floor((height - side) / 2),
        side,
        outputSide: Math.min(side, maxSide),
    };
}

/** * Vietnamese message for a failed upload, from the HTTP status and the server's own validation message. */
export function avatarUploadError(
    status: number | undefined,
    serverMessage?: string,
): string {
    switch (status) {
        case 413:
            return 'Ảnh quá lớn so với giới hạn của máy chủ, hãy chọn ảnh nhỏ hơn.';
        case 422:
            return serverMessage ?? 'Ảnh không hợp lệ.';
        case 419:
            return 'Phiên làm việc đã hết hạn, hãy tải lại trang rồi thử lại.';
        case 403:
            return 'Bạn không có quyền đổi ảnh avatar.';
        case 429:
            return 'Thao tác quá nhanh, hãy đợi một lát rồi thử lại.';
        default:
            return 'Không cập nhật được ảnh.';
    }
}

const encode = (canvas: HTMLCanvasElement, type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));

/**
 * Crops the picked image to a centred square of at most 512 px and encodes it as webp (png when the browser cannot), so the request stays small.
 * An animated gif keeps only its first frame, as on the server. The server still validates the result.
 *
 * @throws Error with a Vietnamese message when the file cannot be used
 */
export async function prepareAvatarFile(file: File): Promise<File> {
    if (!ACCEPTED_TYPES.includes(file.type)) {
        throw new Error('Chỉ nhận ảnh jpg, png, webp hoặc gif.');
    }

    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
        throw new Error(
            'Ảnh gốc quá lớn (tối đa 10 MB), hãy chọn ảnh nhỏ hơn.',
        );
    }

    let bitmap: ImageBitmap;

    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error('Không đọc được ảnh này, hãy thử ảnh khác.');
    }

    const { sourceX, sourceY, side, outputSide } = squareCrop(
        bitmap.width,
        bitmap.height,
    );
    const canvas = document.createElement('canvas');

    canvas.width = outputSide;
    canvas.height = outputSide;

    const context = canvas.getContext('2d');

    if (context === null) {
        bitmap.close();

        throw new Error('Trình duyệt không xử lý được ảnh này.');
    }

    context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        side,
        side,
        0,
        0,
        outputSide,
        outputSide,
    );
    bitmap.close();

    // * A browser without webp encoding falls back to png on its own; the blob's type tells which one it is.
    const blob =
        (await encode(canvas, 'image/webp')) ??
        (await encode(canvas, 'image/png'));

    if (blob === null) {
        throw new Error('Trình duyệt không xử lý được ảnh này.');
    }

    return new File(
        [blob],
        blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.png',
        {
            type: blob.type,
        },
    );
}
