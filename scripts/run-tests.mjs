// Runs every compiled test file with node:test. The file list is built here
// because `node --test` treats a bare argument as a glob on Node 22+ but as a
// literal path on Node 20, so explicit paths work the same everywhere.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { posix } from 'node:path';

// Forward slashes work on every platform and are never read as glob escapes.
const dir = posix.join('dist', 'test');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => posix.join(dir, f));

if (files.length === 0) {
  console.error(`No test files found in ${dir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
