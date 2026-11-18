// A tiny link-preview API: GET /preview?url=https://example.com
//   npm run build && node examples/preview-server.mjs
// Results are cached for ten minutes; errors map to HTTP status codes.
import { createServer } from 'node:http';
import { LruCache, UnfurlError, unfurl } from '../dist/esm/index.js';

const cache = new LruCache({ max: 500, ttl: 10 * 60_000 });
const STATUS = {
  INVALID_URL: 400,
  BLOCKED_URL: 403,
  TIMEOUT: 504,
  HTTP_ERROR: 502,
  UNSUPPORTED_CONTENT_TYPE: 415,
};

createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
  const target = searchParams.get('url');
  if (pathname !== '/preview' || !target) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'use /preview?url=...' }));
    return;
  }
  try {
    const r = await unfurl(target, { cache, timeout: 5000, allowedPorts: [80, 443] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        url: r.canonical ?? r.url,
        title: r.title,
        description: r.description,
        siteName: r.siteName,
        image: r.images[0]?.url,
        favicon: r.favicon,
        themeColor: r.themeColor,
      }),
    );
  } catch (err) {
    const code = err instanceof UnfurlError ? err.code : 'INTERNAL';
    res.writeHead(STATUS[code] ?? 502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: code }));
  }
}).listen(3000, () => console.log('http://localhost:3000/preview?url=https://example.com'));
