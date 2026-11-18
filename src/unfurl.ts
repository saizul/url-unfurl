import { charsetFromContentType, decode, detectCharset } from './charset.js';
import { UnfurlError } from './errors.js';
import { parseHtml, resolveUrl } from './html/extract.js';
import { assertSafeUrl, parseTarget } from './safety/guard.js';
import type { OEmbedData, UnfurlOptions, UnfurlResult } from './types.js';
import { VERSION } from './version.js';

export const DEFAULTS = {
  timeout: 8000,
  maxBytes: 512 * 1024,
  maxRedirects: 5,
  oEmbedMaxBytes: 64 * 1024,
  userAgent: `url-unfurl/${VERSION} (+https://github.com/saizul/url-unfurl)`,
} as const;

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const JSON_TYPES = new Set(['application/json', 'text/json', 'text/javascript', 'text/plain']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

interface Session {
  options: UnfurlOptions;
  signal: AbortSignal;
  timedOut: () => boolean;
}

interface Fetched {
  url: string;
  status: number;
  contentType: string | undefined;
  headerCharset: string | undefined;
  bytes: Uint8Array;
  truncated: boolean;
  redirects: string[];
}

function mapError(err: unknown, session: Session, url: string): UnfurlError {
  if (session.timedOut()) {
    return new UnfurlError('TIMEOUT', `Timed out after ${session.options.timeout ?? DEFAULTS.timeout} ms`, {
      url,
      cause: err,
    });
  }
  if (err instanceof UnfurlError) return err;
  if (session.signal.aborted)
    return new UnfurlError('ABORTED', 'The operation was aborted', { url, cause: err });
  const message = err instanceof Error ? err.message : String(err);
  return new UnfurlError('FETCH_FAILED', `Request failed: ${message}`, { url, cause: err });
}

// Searches for the end of the document head in a chunk, keeping a small tail
// so that a marker split across two chunks is still found. Works for every
// ASCII-compatible encoding, which covers practically all HTML on the web.
function headEndFinder(): (chunk: Uint8Array) => boolean {
  let tail = '';
  return (chunk) => {
    const text = tail + Buffer.from(chunk).toString('latin1');
    tail = text.slice(-6);
    return /<\/head[\s>]|<body[\s>]/i.test(text);
  };
}

async function readBody(
  res: Response,
  maxBytes: number,
  stopAtHeadEnd: boolean,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  const found = headEndFinder();
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
      if (stopAtHeadEnd && found(value)) break;
    }
  } finally {
    // Closes the connection when we stopped early; a no-op when the body is done.
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes, truncated };
}

// DNS lookups cannot be cancelled, so stop waiting for them when the signal fires.
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

async function safeFetch(
  start: URL,
  session: Session,
  accept: string,
  maxBytes: number,
  stopAtHeadEnd: boolean,
  checkType: (contentType: string | undefined, url: string) => void,
): Promise<Fetched> {
  const { options } = session;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const redirects: string[] = [];
  let current = start;

  for (;;) {
    try {
      await untilAborted(assertSafeUrl(current, options), session.signal);
    } catch (err) {
      throw mapError(err, session, current.href);
    }
    let res: Response;
    try {
      res = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: session.signal,
        headers: {
          'user-agent': options.userAgent ?? DEFAULTS.userAgent,
          accept,
          'accept-language': options.acceptLanguage ?? 'en',
          ...options.headers,
        },
      });
    } catch (err) {
      throw mapError(err, session, current.href);
    }

    if (REDIRECTS.has(res.status)) {
      const location = res.headers.get('location');
      res.body?.cancel().catch(() => {});
      if (!location) {
        throw new UnfurlError('FETCH_FAILED', `Redirect ${res.status} without a Location header`, {
          url: current.href,
          status: res.status,
        });
      }
      if (redirects.length >= maxRedirects) {
        throw new UnfurlError('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects`, {
          url: current.href,
        });
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch (cause) {
        throw new UnfurlError('FETCH_FAILED', `Invalid redirect location: ${location}`, {
          url: current.href,
          cause,
        });
      }
      // Re-checked (protocol, credentials, ports, DNS) at the top of the loop.
      parseTarget(next, options);
      current = next;
      redirects.push(current.href);
      continue;
    }

    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw new UnfurlError('HTTP_ERROR', `HTTP ${res.status} ${res.statusText}`.trim(), {
        url: current.href,
        status: res.status,
      });
    }
    const rawType = res.headers.get('content-type');
    const contentType = rawType?.split(';')[0]?.trim().toLowerCase() || undefined;
    try {
      checkType(contentType, current.href);
    } catch (err) {
      res.body?.cancel().catch(() => {});
      throw err;
    }
    let body: { bytes: Uint8Array; truncated: boolean };
    try {
      body = await readBody(res, maxBytes, stopAtHeadEnd);
    } catch (err) {
      throw mapError(err, session, current.href);
    }
    return {
      url: current.href,
      status: res.status,
      contentType,
      headerCharset: charsetFromContentType(rawType),
      ...body,
      redirects,
    };
  }
}

function pickOEmbed(raw: unknown): OEmbedData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not a JSON object');
  const r = raw as Record<string, unknown>;
  const out: OEmbedData = {};
  const str = ['type', 'version', 'title', 'author_name', 'provider_name', 'html'] as const;
  for (const k of str) if (typeof r[k] === 'string' || typeof r[k] === 'number') out[k] = String(r[k]);
  const urls = ['author_url', 'provider_url', 'thumbnail_url', 'url'] as const;
  for (const k of urls) {
    const v = r[k];
    // Only absolute http(s) URLs: a relative URL in an oEmbed response has no meaningful base.
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) {
      const u = resolveUrl(v, v.trim());
      if (u) out[k] = u;
    }
  }
  const nums = ['thumbnail_width', 'thumbnail_height', 'width', 'height'] as const;
  for (const k of nums) {
    const n = Number(r[k]);
    if (r[k] !== undefined && r[k] !== null && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/** The cache key for a URL: the URL without its fragment. */
export function cacheKey(url: string | URL): string {
  const u = new URL(String(url));
  u.hash = '';
  return u.href;
}

/**
 * Fetches a URL and returns link-preview metadata. Rejects with `UnfurlError`
 * for invalid or blocked URLs, timeouts, HTTP errors and non-HTML responses.
 */
export async function unfurl(input: string | URL, options: UnfurlOptions = {}): Promise<UnfurlResult> {
  const start = parseTarget(input, options);
  start.hash = '';
  const key = start.href;
  const cached = options.cache?.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new UnfurlError('TIMEOUT', 'Timed out'));
  }, options.timeout ?? DEFAULTS.timeout);
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const session: Session = { options, signal: controller.signal, timedOut: () => timedOut };

  try {
    const page = await safeFetch(
      start,
      session,
      'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      options.maxBytes ?? DEFAULTS.maxBytes,
      options.stopAtHeadEnd ?? true,
      (type, url) => {
        if (type !== undefined && !HTML_TYPES.has(type)) {
          throw new UnfurlError('UNSUPPORTED_CONTENT_TYPE', `Expected HTML, got ${type}`, { url });
        }
      },
    );
    const charset = detectCharset(page.bytes, page.headerCharset);
    const result = parseHtml(decode(page.bytes, charset), page.url);
    const response: UnfurlResult['response'] = {
      status: page.status,
      charset,
      redirects: page.redirects,
      bytesRead: page.bytes.byteLength,
      truncated: page.truncated,
    };
    if (page.contentType) response.contentType = page.contentType;
    result.response = response;

    if (options.oEmbed && result.oEmbed?.json) {
      try {
        const res = await safeFetch(
          new URL(result.oEmbed.json),
          session,
          'application/json',
          DEFAULTS.oEmbedMaxBytes,
          false,
          (type, url) => {
            if (type !== undefined && !JSON_TYPES.has(type) && !type.endsWith('+json')) {
              throw new UnfurlError('UNSUPPORTED_CONTENT_TYPE', `Expected JSON, got ${type}`, { url });
            }
          },
        );
        if (res.truncated) throw new Error('response is larger than the oEmbed limit');
        result.oEmbed.data = pickOEmbed(JSON.parse(decode(res.bytes, 'utf-8')));
      } catch (err) {
        if (err instanceof UnfurlError && (err.code === 'TIMEOUT' || err.code === 'ABORTED')) throw err;
        result.oEmbed.error = err instanceof Error ? err.message : String(err);
      }
    }

    options.cache?.set(key, result);
    return result;
  } catch (err) {
    throw mapError(err, session, key);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
