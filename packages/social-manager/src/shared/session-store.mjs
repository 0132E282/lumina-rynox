import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject } from './util.mjs';

/**
 * A small JSON file store for the replay template (and, for Facebook, the session tokens).
 * ! May hold live credentials: written 0600, never printed or logged. Keep it out of version control.
 * Only `allowedKeys` are ever persisted, so unknown/legacy keys are dropped on the next write.
 *
 * @param {string} file
 * @param {string[]} allowedKeys
 */
export function createSessionStore(file, allowedKeys) {
    function read() {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            return isPlainObject(data) ? data : {};
        } catch {
            return {};
        }
    }

    return {
        read,
        /** Merges `patch` into the stored known keys. */
        write(patch) {
            const merged = { ...read(), ...patch };
            const data = Object.fromEntries(
                allowedKeys
                    .filter((key) => merged[key] !== undefined)
                    .map((key) => [key, merged[key]]),
            );
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(
                file,
                JSON.stringify({ ...data, saved_at: new Date().toISOString() }),
                { mode: 0o600 },
            );
            fs.chmodSync(file, 0o600);
        },
        remove() {
            fs.rmSync(file, { force: true });
        },
    };
}
