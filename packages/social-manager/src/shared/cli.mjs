import { exitCodeFor } from './errors.mjs';

async function readStdin(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Thin CLI over a provider client. Contract (same as the original scripts): `<mode>` is argv[2]; `post` reads
 * `{"text","audience","images"}` (plus optional `"group_url"` to post into a group page) from stdin; exactly ONE JSON line goes to stdout; the exit code is 0 or the fixed error code.
 *
 * @param {object} options
 * @param {Record<string, Function>} options.client Provider client (`createFacebook()` / `createLinkedin()`).
 * @param {string[]} options.modes Accepted modes.
 * @param {string | undefined} options.mode argv[2].
 * @param {NodeJS.ReadableStream} [options.stdin]
 * @param {(line: string) => void} [options.write]
 * @returns {Promise<number>} exit code
 */
export async function runCli({
    client,
    modes,
    mode,
    stdin = process.stdin,
    write = (line) => process.stdout.write(line),
}) {
    let result;
    if (!modes.includes(mode)) {
        result = { ok: false, error: 'invalid_input' };
    } else if (mode === 'post') {
        let input;
        try {
            input = JSON.parse(await readStdin(stdin));
        } catch {
            input = undefined;
        }
        result =
            input === undefined
                ? { ok: false, error: 'invalid_input' }
                : await client.post(input);
    } else {
        result = await client[mode]();
    }

    write(`${JSON.stringify(result)}\n`);
    return exitCodeFor(result);
}
