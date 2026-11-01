# social-manager

Reusable ESM plugin that manages the user's own Facebook and LinkedIn accounts by driving a REAL Chrome with a dedicated persistent profile (plain Playwright: no stealth, no fingerprint/header tweaks, no captcha tricks). Runs on the user's machine only.

Capabilities per provider (`facebook`, `linkedin`):

| Method                                              | What it does                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `login()`                                           | Human logs in manually in the opened window; resolves when the session cookie exists                                   |
| `check()`                                           | `{ok: true, loggedIn}`                                                                                                 |
| `session()`                                         | Login check; Facebook also refreshes the saved cookie header/tokens, LinkedIn reports whether a replay template exists |
| `post({text, audience?, images?})`                  | Posts to the user's own profile/feed (text + http(s) images, no video)                                                 |
| `groups()`                                          | Read-only: scrolls "my groups" and returns `[{id, name, url}]`                                                         |
| `postToGroup({groupUrl, text, audience?, images?})` | **Not implemented yet** (see below)                                                                                    |
| `learn()` (LinkedIn only)                           | Human posts the marker text once per audience; the request is captured and BLOCKED and becomes the replay template     |

Requires Node >= 20, Google Chrome and `playwright-core` (peer dependency, not bundled).

## Library usage

```js
import { createFacebook, createLinkedin } from 'social-manager';

const facebook = createFacebook({ storageDirectory: '/path/to/storage' });
await facebook.login();
const result = await facebook.post({
  text: 'Hello',
  audience: 'self', // facebook: self | friends | public. linkedin: public | connections
  images: ['https://example.com/a.jpg'],
});
// {ok: true, via: 'browser-api' | 'ui', post_id?, url?}  or  {ok: false, error: '<fixed code>'}
```

Options: `storageDirectory` (default `~/.social-manager`; holds `<provider>-profile/` and `<provider>-session.json`, 0600, may contain live credentials, keep out of git), `profileDirectory`, `sessionFile`, `headless` (never applied to `login`/`learn`).

Every method resolves to ONE JSON-safe object and never throws. Failures are `{ok: false, error}` with one of the fixed codes in `ERROR_EXIT_CODES` (`unknown 1`, `not_logged_in 10`, `composer_not_found 11`, `timeout 12`, `checkpoint 13`, `invalid_input 14`, `audience_not_set 15`, `browser_unavailable 16`, `image_download_failed 17`, `image_upload_failed 18`). Page content, cookies and profile data are never returned.

## CLI

```text
node packages/social-manager/bin/facebook.mjs <login|check|session|groups|post>
node packages/social-manager/bin/linkedin.mjs <login|check|session|learn|groups|post>
echo '{"text":"...","audience":"self","images":["https://..."]}' | node packages/social-manager/bin/facebook.mjs post
echo '{"text":"...","group_url":"https://www.facebook.com/groups/<id>/"}' | node packages/social-manager/bin/facebook.mjs post
```

Same contract as `scripts/facebook-post.mjs` / `scripts/linkedin-post.mjs`: one JSON line on stdout, exit code 0 or the fixed code. Storage defaults to this repository's `storage/app` (override with `SOCIAL_MANAGER_STORAGE_DIR`); `FACEBOOK_HEADLESS=1` / `LINKEDIN_HEADLESS=1` hide the window.

## Safety rules (kept from the scripts)

- A checkpoint/captcha is never bypassed: the operation stops with `checkpoint`.
- The audience is verified before submitting; if it cannot be verified nothing is posted (`audience_not_set`).
- Text-only posts replay the composer's own request inside the logged-in page. Only a DEFINITIVE rejection (HTTP 4xx, or only `errors` without `data`) falls back, once, to the UI; any ambiguous result is `unknown` and is never retried.
- After the submit click every failure is `unknown`.
- Images: http(s) only, `image/*`, <= 10 MB each (Facebook <= 10 images, LinkedIn <= 9), downloaded to a temp directory removed afterwards.

## Layout

- `src/shared/`: Chrome launch, `StepError`/exit codes, input validation, image download, template capture/replay (`template.mjs`), session store, groups scraping, login/typing helpers, CLI runner, operation runner (deadline + cleanup).
- `src/facebook/`, `src/linkedin/`: `selectors.mjs` (the ONLY place with site selectors/texts; fix a break there), `template.mjs` (pure helpers), `index.mjs` (browser flows + public client).
- `bin/`: CLI entries. `test/`: `node --test` unit tests for the pure helpers (no browser).

## Group posting

`postToGroup({groupUrl, text, images?})` (CLI: `post` with `"group_url"` in the stdin JSON) opens the group page, uses that page's own composer and submits. Rules:

- `groupUrl` must be a bare https group page on the provider's host (Facebook `https://www.facebook.com/groups/<id>/`, LinkedIn `https://www.linkedin.com/groups/<numeric id>/`); anything else, including a query string, is `invalid_input` before any browser or download.
- It never uses the replay template (that belongs to the timeline/feed).
- There is NO audience step: a group post is seen by the group, so `audience` is ignored. The audience-verification rule still applies to the personal timeline/feed flows.
- Failures before the submit click are fixed codes; from the click on any failure is `unknown` and is never retried.
- The group composer selectors (`groupComposerTrigger`, `groupComposerTextbox`) are UNVERIFIED against the live sites; fix them in `src/<provider>/selectors.mjs`.

## Tests

```text
pnpm test:social-manager   # from the repository root
```
