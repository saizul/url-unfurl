import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { run } from '../src/cli/run.js';
import { UnfurlError, type UnfurlOptions, type unfurl, VERSION } from '../src/index.js';
import { html, serve } from './helpers.js';

async function cli(args: string[], fake?: typeof unfurl) {
  let stdout = '';
  let stderr = '';
  const io = {
    stdout: (t: string) => {
      stdout += t;
    },
    stderr: (t: string) => {
      stderr += t;
    },
    ...(fake ? { unfurl: fake } : {}),
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

const articlePath = fileURLToPath(new URL('../../test/fixtures/article.html', import.meta.url));

describe('cli', () => {
  it('prints help and the version', async () => {
    const h = await cli(['--help']);
    assert.equal(h.code, 0);
    assert.match(h.stdout, /Usage/);
    const v = await cli(['-v']);
    assert.equal(v.stdout, `${VERSION}\n`);
  });

  it('parses a local file as JSON', async () => {
    const r = await cli(['--file', articlePath, '--base', 'https://news.example.com/a', '--json']);
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(data.title, 'Rocket launch & landing — a first');
    assert.equal(data.canonical, 'https://news.example.com/news/2026/rocket-launch');
  });

  it('prints aligned human-readable output', async () => {
    const r = await cli(['--file', articlePath, '--base', 'https://news.example.com/a']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^Title {9}Rocket launch/m);
    assert.match(r.stdout, /^Image {9}https:\/\/secure\.example\.com\/rocket\.jpg \(1200x630\)$/m);
    assert.match(r.stdout, /^JSON-LD {7}NewsArticle$/m);
    assert.doesNotMatch(r.stdout, /undefined/);
  });

  it('passes options to unfurl', async () => {
    let seen: UnfurlOptions | undefined;
    const fake = (async (_url: string | URL, options?: UnfurlOptions) => {
      seen = options;
      return {
        url: 'https://x.example/',
        favicon: 'https://x.example/favicon.ico',
        keywords: [],
        icons: [],
        images: [],
        videos: [],
        audio: [],
        feeds: [],
        openGraph: {},
        twitter: {},
      };
    }) as typeof unfurl;
    const r = await cli(
      [
        'https://x.example/',
        '--timeout',
        '100',
        '--max-bytes',
        '2048',
        '--max-redirects',
        '0',
        '--oembed',
        '--user-agent',
        'ua',
      ],
      fake,
    );
    assert.equal(r.code, 0);
    assert.deepEqual(seen, {
      timeout: 100,
      maxBytes: 2048,
      maxRedirects: 0,
      oEmbed: true,
      stopAtHeadEnd: true,
      allowPrivateNetworks: false,
      userAgent: 'ua',
    });
  });

  it('exits with 1 and a code on unfurl errors', async () => {
    const fake = (async () => {
      throw new UnfurlError('BLOCKED_URL', 'nope');
    }) as typeof unfurl;
    const r = await cli(['http://10.0.0.1/', '--json'], fake);
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.stdout), { error: { code: 'BLOCKED_URL', message: 'nope' } });
    assert.match(r.stderr, /BLOCKED_URL/);
  });

  it('blocks private addresses unless --allow-private is given', async () => {
    const srv = await serve({ '/': html('<title>Local</title>') });
    const blocked = await cli([`${srv.origin}/`]);
    assert.equal(blocked.code, 1);
    const ok = await cli([`${srv.origin}/`, '--allow-private', '--json']);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).title, 'Local');
  });

  it('exits with 2 on usage errors', async () => {
    for (const args of [
      [],
      ['a', 'b'],
      ['--nope'],
      ['x', '--timeout', 'soon'],
      ['x', '--file', articlePath],
    ]) {
      const r = await cli(args);
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.stderr, /url-unfurl:/);
    }
    const missing = await cli(['--file', '/definitely/not/here.html']);
    assert.equal(missing.code, 2);
  });
});
