import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import * as esm from '../src/index.js';

const require = createRequire(import.meta.url);

describe('package', () => {
  it('the CommonJS build exposes the same API', () => {
    const cjs = require('../cjs/index.js') as typeof esm;
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
    const r = cjs.parseHtml('<title>CJS</title>', 'https://example.com/');
    assert.equal(r.title, 'CJS');
  });

  it('the CommonJS folder is marked as commonjs', () => {
    const pkg = JSON.parse(readFileSync(new URL('../cjs/package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.type, 'commonjs');
  });

  it('has no runtime dependencies and versions agree', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.version, esm.VERSION);
    assert.equal(pkg.name, '@saizul/url-unfurl');
    assert.equal(pkg.bin['url-unfurl'], './dist/esm/cli.js');
  });

  it('the CLI entry starts with a shebang', () => {
    const cli = readFileSync(new URL('../esm/cli.js', import.meta.url), 'utf8');
    assert.ok(cli.startsWith('#!/usr/bin/env node'));
  });

  it('the README documents every error code and result field', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const codes =
      readFileSync(new URL('../../src/errors.ts', import.meta.url), 'utf8').match(/'[A-Z_]+'/g) ?? [];
    assert.ok(codes.length >= 9);
    for (const c of codes) assert.ok(readme.includes(`\`${c.slice(1, -1)}\``), c);
    const r = esm.parseHtml('', 'https://example.com/');
    for (const key of Object.keys(r)) assert.ok(readme.includes(key), key);
  });
});
