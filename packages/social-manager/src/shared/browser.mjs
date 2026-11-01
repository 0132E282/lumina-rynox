import { StepError } from './errors.mjs';

/**
 * Opens a REAL Chrome with a dedicated persistent profile. Plain Playwright: no stealth, fingerprint, header or webdriver tweaks.
 * @param {{profileDirectory: string, headless: boolean}} options
 */
export async function openContext({ profileDirectory, headless }) {
    try {
        const { chromium } = await import('playwright-core');
        return await chromium.launchPersistentContext(profileDirectory, {
            channel: 'chrome',
            headless,
        });
    } catch {
        // ! The launch error can name local paths: only the fixed code leaves the package.
        throw new StepError('browser_unavailable');
    }
}

/** True when the cookie exists for the URL. Only its presence is tested, the value is never read. */
export async function hasCookie(context, url, name) {
    const cookies = await context.cookies(url);
    return cookies.some((cookie) => cookie.name === name);
}

/** @param {string} checkpointUrl RegExp tested on the page URL */
export async function isCheckpoint(page, { checkpointUrl, checkpointText }) {
    if (checkpointUrl.test(page.url())) {
        return true;
    }
    return page
        .getByText(checkpointText)
        .first()
        .isVisible()
        .catch(() => false);
}

export async function openPage(context, url, timeoutMs) {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: timeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }
    return page;
}
