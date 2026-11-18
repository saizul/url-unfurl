import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LruCache, UnfurlError, type UnfurlResult, unfurl } from '../src/index.js';
import { fixture, html, LOCAL, serve } from './helpers.js';

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof UnfurlError, `expected UnfurlError, got ${String(err)}`);
    assert.equal(err.code, code, err.message);
    return true;
  });
}

const HEAD = '<html><head><title>Streamed</title><meta property="og:title" content="Early"></head>';

const srv = await serve({
  '/article': html(fixture('article.html')),
  '/r1': (_req, res) => {
    res.writeHead(301, { location: '/r2' });
    res.end();
  },
  '/r2': (_req, res) => {
    res.writeHead(302, { location: '/article' });
    res.end();
  },
  '/loop': (_req, res) => {
    res.writeHead(307, { location: '/loop' });
    res.end();
  },
  '/no-location': (_req, res) => {
    res.writeHead(302);
    res.end();
  },
  '/to-metadata': (_req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  },
  '/hang': () => {
    // Never responds.
  },
  '/slow-body': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<html><head><title>never finished');
  },
  '/head-then-hang': (_req, res) => {
    // Sends the whole head, then keeps the connection open forever.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write(HEAD);
  },
  '/split-head': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<title>Split</title></he');
    setTimeout(() => res.write('ad><body>'), 20);
  },
  '/huge': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<html><head><title>Huge</title>');
    const chunk = `<meta name="filler" content="${'x'.repeat(4000)}">`;
    const pump = () => {
      while (res.write(chunk)) {
        if (res.writableLength > 1_000_000) break;
      }
    };
    pump();
    res.on('drain', pump);
  },
  '/json': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"title":"not html"}');
  },
  '/image': (_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  },
  '/no-type': (_req, res) => {
    res.writeHead(200);
    res.end('<title>No type</title>');
  },
  '/latin1': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=ISO-8859-1' });
    res.end(Buffer.from('<title>Café crème</title>', 'latin1'));
  },
  '/meta-charset': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    // 0x80 is the euro sign in windows-1252.
    res.end(
      Buffer.concat([
        Buffer.from('<meta charset="windows-1252"><title>Price: '),
        Buffer.from([0x80]),
        Buffer.from('5</title>'),
      ]),
    );
  },
  '/bom': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
    res.end(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<title>über</title>', 'utf8')]));
  },
  '/missing': (_req, res) => {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<title>Not found</title>');
  },
  '/headers': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<title>${req.headers['user-agent']}|${req.headers['accept-language']}|${req.headers['x-extra']}</title>`,
    );
  },
  '/counted': html('<title>Counted</title>'),
  '/video': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<link rel="alternate" type="application/json+oembed" href="/oembed.json"><title>Video</title>`);
  },
  '/oembed.json': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        type: 'video',
        version: '1.0',
        title: 'Video',
        provider_name: 'Local',
        thumbnail_url: 'https://img.example/t.jpg',
        width: '640',
        height: 360,
        html: '<iframe src="https://player.example/1"></iframe>',
        author_url: 'javascript:alert(1)',
        extra: 'dropped',
      }),
    );
  },
  '/video-bad-oembed': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<link rel="alternate" type="application/json+oembed" href="/missing"><title>V</title>');
  },
});
const o = srv.origin;

describe('unfurl over HTTP', () => {
  it('fetches and parses a page', async () => {
    const r = await unfurl(`${o}/article`, LOCAL);
    assert.equal(r.title, 'Rocket launch & landing — a first');
    assert.equal(r.response?.status, 200);
    assert.equal(r.response?.contentType, 'text/html');
    assert.equal(r.response?.charset, 'utf-8');
    assert.equal(r.response?.truncated, false);
    assert.equal(r.favicon, `${o}/favicon.svg`);
  });

  it('follows redirects and reports the final URL', async () => {
    const r = await unfurl(`${o}/r1`, LOCAL);
    assert.equal(r.url, `${o}/article`);
    assert.deepEqual(r.response?.redirects, [`${o}/r2`, `${o}/article`]);
  });

  it('stops after maxRedirects', async () => {
    await rejectsWith(unfurl(`${o}/loop`, { ...LOCAL, maxRedirects: 3 }), 'TOO_MANY_REDIRECTS');
    await rejectsWith(unfurl(`${o}/r1`, { ...LOCAL, maxRedirects: 1 }), 'TOO_MANY_REDIRECTS');
    assert.equal(srv.hits.get('/loop'), 4);
  });

  it('rejects a redirect without Location', async () => {
    await rejectsWith(unfurl(`${o}/no-location`, LOCAL), 'FETCH_FAILED');
  });

  it('blocks a redirect from an allowed host to cloud metadata', async () => {
    await rejectsWith(unfurl(`${o}/to-metadata`, LOCAL), 'BLOCKED_URL');
  });

  it('blocks the local server itself without an explicit allowance', async () => {
    await rejectsWith(unfurl(`${o}/article`), 'BLOCKED_URL');
  });

  it('times out when the server never answers', async () => {
    const start = Date.now();
    await rejectsWith(unfurl(`${o}/hang`, { ...LOCAL, timeout: 200 }), 'TIMEOUT');
    assert.ok(Date.now() - start < 2000);
  });

  it('times out while reading a body that never ends', async () => {
    await rejectsWith(unfurl(`${o}/slow-body`, { ...LOCAL, timeout: 200 }), 'TIMEOUT');
  });

  it('stops reading at </head> instead of waiting for the rest', async () => {
    const r = await unfurl(`${o}/head-then-hang`, { ...LOCAL, timeout: 2000 });
    assert.equal(r.title, 'Early');
    assert.equal(r.response?.bytesRead, Buffer.byteLength(HEAD));
  });

  it('finds </head> split across chunks', async () => {
    const r = await unfurl(`${o}/split-head`, { ...LOCAL, timeout: 2000 });
    assert.equal(r.title, 'Split');
  });

  it('stops at maxBytes and marks the result truncated', async () => {
    const r = await unfurl(`${o}/huge`, { ...LOCAL, maxBytes: 20_000 });
    assert.equal(r.title, 'Huge');
    assert.equal(r.response?.bytesRead, 20_000);
    assert.equal(r.response?.truncated, true);
  });

  it('rejects non-HTML content types', async () => {
    await rejectsWith(unfurl(`${o}/json`, LOCAL), 'UNSUPPORTED_CONTENT_TYPE');
    await rejectsWith(unfurl(`${o}/image`, LOCAL), 'UNSUPPORTED_CONTENT_TYPE');
  });

  it('accepts a response without Content-Type', async () => {
    const r = await unfurl(`${o}/no-type`, LOCAL);
    assert.equal(r.title, 'No type');
    assert.equal(r.response?.contentType, undefined);
  });

  it('decodes with the charset from the header, a meta tag or a BOM', async () => {
    const a = await unfurl(`${o}/latin1`, LOCAL);
    assert.equal(a.title, 'Café crème');
    assert.equal(a.response?.charset, 'windows-1252');
    const b = await unfurl(`${o}/meta-charset`, LOCAL);
    assert.equal(b.title, 'Price: €5');
    const c = await unfurl(`${o}/bom`, LOCAL);
    assert.equal(c.title, 'über');
    assert.equal(c.response?.charset, 'utf-8');
  });

  it('rejects HTTP errors with the status', async () => {
    await assert.rejects(unfurl(`${o}/missing`, LOCAL), (err: unknown) => {
      assert.ok(err instanceof UnfurlError);
      assert.equal(err.code, 'HTTP_ERROR');
      assert.equal(err.status, 404);
      return true;
    });
  });

  it('sends the user agent, language and extra headers', async () => {
    const r = await unfurl(`${o}/headers`, {
      ...LOCAL,
      userAgent: 'test-agent',
      acceptLanguage: 'de',
      headers: { 'x-extra': '1' },
    });
    assert.equal(r.title, 'test-agent|de|1');
    const d = await unfurl(`${o}/headers`, LOCAL);
    assert.match(d.title ?? '', /^url-unfurl\/\d+\.\d+\.\d+ /);
  });

  it('honours an abort signal', async () => {
    const controller = new AbortController();
    const p = unfurl(`${o}/hang`, { ...LOCAL, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await rejectsWith(p, 'ABORTED');
    await rejectsWith(unfurl(`${o}/article`, { ...LOCAL, signal: AbortSignal.abort() }), 'ABORTED');
  });

  it('serves repeated URLs from the cache', async () => {
    const cache = new LruCache<UnfurlResult>({ max: 10 });
    const a = await unfurl(`${o}/counted`, { ...LOCAL, cache });
    const b = await unfurl(`${o}/counted#section`, { ...LOCAL, cache });
    assert.equal(a, b);
    assert.equal(srv.hits.get('/counted'), 1);
    assert.equal(cache.size, 1);
  });

  it('fetches and sanitizes oEmbed data when asked', async () => {
    const without = await unfurl(`${o}/video`, LOCAL);
    assert.equal(without.oEmbed?.json, `${o}/oembed.json`);
    assert.equal(without.oEmbed?.data, undefined);

    const r = await unfurl(`${o}/video`, { ...LOCAL, oEmbed: true });
    assert.deepEqual(r.oEmbed?.data, {
      type: 'video',
      version: '1.0',
      title: 'Video',
      provider_name: 'Local',
      html: '<iframe src="https://player.example/1"></iframe>',
      thumbnail_url: 'https://img.example/t.jpg',
      width: 640,
      height: 360,
    });
  });

  it('keeps the page result when the oEmbed request fails', async () => {
    const r = await unfurl(`${o}/video-bad-oembed`, { ...LOCAL, oEmbed: true });
    assert.equal(r.title, 'V');
    assert.match(r.oEmbed?.error ?? '', /404/);
  });

  it('rejects invalid input before doing any work', async () => {
    await rejectsWith(unfurl('nope'), 'INVALID_URL');
    await rejectsWith(unfurl('javascript:alert(1)'), 'BLOCKED_URL');
  });
});
