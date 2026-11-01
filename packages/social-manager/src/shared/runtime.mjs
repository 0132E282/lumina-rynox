import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openContext } from './browser.mjs';
import { StepError } from './errors.mjs';
import { downloadImages } from './images.mjs';

/**
 * Runs one operation end to end and ALWAYS resolves to the JSON result object (never throws, never carries page content):
 * `prepare` (input validation, image download) -> Chrome launch -> `run` raced against a deadline -> cleanup.
 *
 * @param {object} options
 * @param {string} options.profileDirectory
 * @param {boolean} options.headless Requested headless mode; ignored when `interactive`.
 * @param {boolean} options.interactive A human must see the window (login, learn).
 * @param {number} options.deadlineMs
 * @param {string} options.tempPrefix Prefix of the temp directory that holds downloaded images.
 * @param {boolean} [options.reportLoggedOut] `not_logged_in` becomes `{ok: true, loggedIn: false}` (check, session).
 * @param {object} options.limits Needs imageMaxBytes and imageDownloadTimeoutMs.
 * @param {(workspace: {downloadImages: (urls: string[]) => Promise<string[]>}) => Promise<unknown>} [options.prepare]
 * @param {(context: import('playwright-core').BrowserContext, prepared: unknown) => Promise<object>} options.run
 */
export async function runOperation({
    profileDirectory,
    headless,
    interactive,
    deadlineMs,
    tempPrefix,
    reportLoggedOut = false,
    limits,
    prepare,
    run,
}) {
    let context = null;
    let deadlineTimer = null;
    let tempDirectory = null;

    try {
        const workspace = {
            downloadImages: async (urls) => {
                if (urls.length === 0) {
                    return [];
                }
                tempDirectory ??= fs.mkdtempSync(
                    path.join(os.tmpdir(), tempPrefix),
                );
                return downloadImages(urls, tempDirectory, limits);
            },
        };
        const prepared = prepare ? await prepare(workspace) : undefined;
        context = await openContext({
            profileDirectory,
            headless: headless && !interactive,
        });

        const deadline = new Promise((_, reject) => {
            deadlineTimer = setTimeout(
                () => reject(new StepError('timeout')),
                deadlineMs,
            );
        });
        return await Promise.race([run(context, prepared), deadline]);
    } catch (error) {
        const code = error instanceof StepError ? error.code : 'unknown';
        return reportLoggedOut && code === 'not_logged_in'
            ? { ok: true, loggedIn: false }
            : { ok: false, error: code };
    } finally {
        clearTimeout(deadlineTimer);
        if (tempDirectory !== null) {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
        await context?.close().catch(() => undefined);
    }
}
