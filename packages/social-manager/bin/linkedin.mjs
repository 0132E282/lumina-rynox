#!/usr/bin/env node
// node packages/social-manager/bin/linkedin.mjs <login|check|session|learn|groups|post>  (post accepts "group_url" for a group page)
// Storage: SOCIAL_MANAGER_STORAGE_DIR, else this repository's storage/app (the same profile/session files the old script used).
// Env LINKEDIN_HEADLESS=1 hides the window (never for `login` / `learn`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLinkedin, LINKEDIN_MODES } from '../src/linkedin/index.mjs';
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
    client: createLinkedin({
        storageDirectory:
            process.env.SOCIAL_MANAGER_STORAGE_DIR ?? repositoryStorage,
        headless: process.env.LINKEDIN_HEADLESS === '1',
    }),
    modes: LINKEDIN_MODES,
    mode: process.argv[2],
});
