import fs from 'node:fs';
import path from 'node:path';
import { StepError } from './errors.mjs';
import { DEFAULT_LIMITS } from './limits.mjs';

const IMAGE_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

/** Downloads one image to `directory`. Any problem is `image_download_failed`; the URL is never reported. */
export async function downloadImage(
    url,
    directory,
    index,
    limits = DEFAULT_LIMITS,
) {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(limits.imageDownloadTimeoutMs),
        });
        const type = (response.headers.get('content-type') ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase();
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (
            !response.ok ||
            !type.startsWith('image/') ||
            declared > limits.imageMaxBytes
        ) {
            throw new Error('rejected');
        }

        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > limits.imageMaxBytes) {
                throw new Error('too_large');
            }
            chunks.push(chunk);
        }
        if (size === 0) {
            throw new Error('empty');
        }

        const file = path.join(
            directory,
            `image-${index}${IMAGE_EXTENSIONS[type] ?? '.img'}`,
        );
        fs.writeFileSync(file, Buffer.concat(chunks), { mode: 0o600 });
        return file;
    } catch {
        throw new StepError('image_download_failed');
    }
}

/** Downloads the images in order and returns the local file paths. */
export async function downloadImages(urls, directory, limits = DEFAULT_LIMITS) {
    const files = [];
    for (let index = 0; index < urls.length; index += 1) {
        files.push(await downloadImage(urls[index], directory, index, limits));
    }
    return files;
}
