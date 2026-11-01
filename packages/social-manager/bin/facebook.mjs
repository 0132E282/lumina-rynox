#!/usr/bin/env node
// node packages/social-manager/bin/facebook.mjs <login|check|session|groups|post>  (post accepts "group_url" for a group page)
// Storage: SOCIAL_MANAGER_STORAGE_DIR, else this repository's storage/app (the same profile/session files the old script used).
// Env FACEBOOK_HEADLESS=1 hides the window (never for `login`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFacebook, FACEBOOK_MODES } from '../src/facebook/index.mjs';
import { runCli } from '../src/shared/cli.mjs';

const repositoryStorage = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'storage',
    'app',
);

process.exitCode = await runCli({
    client: createFacebook({
        storageDirectory:
            process.env.SOCIAL_MANAGER_STORAGE_DIR ?? repositoryStorage,
        headless: process.env.FACEBOOK_HEADLESS === '1',
    }),
    modes: FACEBOOK_MODES,
    mode: process.argv[2],
});
