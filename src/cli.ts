#!/usr/bin/env node
import { run } from './cli/run.js';

run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`url-unfurl: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  },
);
