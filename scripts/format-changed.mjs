import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
}).trim();
const changed = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD', '--'],
    { cwd: root, encoding: 'utf8' },
);
const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
);
const files = [...new Set(`${changed}${untracked}`.split('\0'))].filter(
    (file) => file && existsSync(path.join(root, file)),
);
if (files.length) {
    const result = spawnSync(
        path.join(root, 'node_modules', '.bin', 'prettier'),
        [
            process.argv.includes('--check') ? '--check' : '--write',
            '--ignore-unknown',
            ...files,
        ],
        { cwd: root, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} else {
    console.log('Không có file thay đổi cần format.');
}
