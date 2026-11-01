import { StepError } from './errors.mjs';
import { sleep } from './util.mjs';

/**
 * Pure: turns the `{href, text}` anchors seen on a groups page into a de-duplicated group map keyed by group id.
 * An anchor counts only on `hostname` with a path matching `groupPath` (group id = first capture group).
 * @param {{href: string, text: string}[]} links
 * @param {Map<string, {id: string, name: string, url: string}>} groups mutated and returned
 */
export function collectGroups(
    links,
    { hostname, groupPath, groupLinkLabel, groupUrl, groupNameMax },
    groups = new Map(),
) {
    for (const link of links) {
        let url;
        try {
            url = new URL(link.href);
        } catch {
            continue;
        }
        const match = groupPath.exec(url.pathname);
        if (url.hostname !== hostname || match === null) {
            continue;
        }
        const name = (
            link.text.split('\n').find((line) => line.trim() !== '') ?? ''
        )
            .trim()
            .slice(0, groupNameMax);
        const previous = groups.get(match[1]);
        if (previous === undefined || (previous.name === '' && name !== '')) {
            groups.set(match[1], {
                id: match[1],
                name: groupLinkLabel.test(name) ? '' : name,
                url: groupUrl(match[1]),
            });
        }
    }
    return groups;
}

/** Read-only: scrolls the "my groups" page and lists id, name and link of each group. Nothing is clicked, joined or posted. */
export async function scrapeGroups(page, config, limits) {
    try {
        await page.goto(config.groupsUrl, {
            waitUntil: 'domcontentloaded',
            timeout: limits.stepTimeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }

    const groups = new Map();
    let idleRounds = 0;
    for (
        let round = 0;
        round < limits.groupScrollRounds && idleRounds < 2;
        round += 1
    ) {
        const links = await page
            .evaluate(() =>
                [...document.querySelectorAll('a[href*="/groups/"]')].map(
                    (anchor) => ({
                        href: anchor.href,
                        text: (
                            anchor.innerText ||
                            anchor.getAttribute('aria-label') ||
                            ''
                        ).trim(),
                    }),
                ),
            )
            .catch(() => []);

        const before = groups.size;
        collectGroups(
            links,
            { ...config, groupNameMax: limits.groupNameMax },
            groups,
        );

        idleRounds = groups.size === before ? idleRounds + 1 : 0;
        await page.mouse.wheel(0, 2500);
        await sleep(1_200);
    }

    return {
        ok: true,
        groups: [...groups.values()]
            .filter((group) => group.name !== '')
            .slice(0, limits.groupsMax),
    };
}
