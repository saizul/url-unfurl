# url-unfurl

[![CI](https://github.com/saizul/url-unfurl/actions/workflows/ci.yml/badge.svg)](https://github.com/saizul/url-unfurl/actions/workflows/ci.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-blue)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![TypeScript](https://img.shields.io/badge/types-included-blue)
![ESM + CJS](https://img.shields.io/badge/module-ESM%20%2B%20CJS-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

Fetch a URL and get the link-preview metadata that Slack, Discord and
iMessage show: title, description, image, site name, favicon, theme color,
Open Graph, Twitter cards, oEmbed endpoints and JSON-LD.

- **Safe by default.** An SSRF guard blocks private, loopback, link-local and
  cloud-metadata addresses (IPv4 and IPv6, including mapped and embedded
  forms), checks every DNS record and re-checks every redirect.
- **Bounded.** One total timeout, a redirect limit, a byte limit, and it
  stops reading as soon as `</head>` arrives.
- **Correct text.** Character sets from the header, a BOM or `<meta charset>`;
  HTML entities decoded; whitespace collapsed.
- **Small.** A hand-written, linear-time HTML head scanner instead of a DOM
  library. Zero runtime dependencies. Ships ESM, CommonJS and types.
- **Offline too.** `parseHtml(html, baseUrl)` works on HTML you already have.

```console
$ npx @saizul/url-unfurl --file test/fixtures/article.html --base https://news.example.com/news/2026/rocket-launch
Title         Rocket launch & landing — a first
Description   The booster landed on its second try.
Site          Example News
URL           https://news.example.com/news/2026/rocket-launch
Type          article
Author        Ada Example
Published     2026-11-01T08:00:00Z
Image         https://secure.example.com/rocket.jpg (1200x630)
Favicon       https://news.example.com/favicon.svg
Theme color   #fafafa
Language      en-GB
Twitter card  summary_large_image
JSON-LD       NewsArticle
```

Point it at a live URL (`npx @saizul/url-unfurl https://example.com`) and
it fetches the page first, safely.

## Contents

- [Quick start](#quick-start)
- [Install](#install)
- [Library usage](#library-usage)
- [Output schema](#output-schema)
- [What is extracted, and from where](#what-is-extracted-and-from-where)
- [Options](#options)
- [Errors](#errors)
- [CLI](#cli)
- [Security](#security)
- [API](#api)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Quick start

```ts
import { unfurl } from '@saizul/url-unfurl';

const preview = await unfurl('https://example.com/blog/post');
console.log(preview.title, preview.description, preview.images[0]?.url, preview.favicon);
```

Already have the HTML (from a crawler, a queue, a test fixture)? Skip the
network entirely:

```ts
import { parseHtml } from '@saizul/url-unfurl';

const preview = parseHtml(html, 'https://example.com/blog/post');
```

## Install

The package is published to GitHub Packages. Tell npm where the `@saizul`
scope lives, once per project:

```console
$ echo "@saizul:registry=https://npm.pkg.github.com" >> .npmrc
$ npm install @saizul/url-unfurl
```

GitHub Packages needs a token with `read:packages` even for public packages;
see [GitHub's documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages).

Requires Node 20 or newer (it uses the global `fetch`). Both module systems
work:

```js
import { unfurl, parseHtml } from '@saizul/url-unfurl'; // ESM
const { unfurl, parseHtml } = require('@saizul/url-unfurl'); // CommonJS
```

## Library usage

### A preview endpoint with a cache

```ts
import { LruCache, UnfurlError, unfurl, type UnfurlResult } from '@saizul/url-unfurl';

const cache = new LruCache<UnfurlResult>({ max: 500, ttl: 10 * 60_000 });

export async function preview(url: string) {
  try {
    const r = await unfurl(url, { cache, timeout: 5000, allowedPorts: [80, 443] });
    return { title: r.title, description: r.description, image: r.images[0]?.url, icon: r.favicon };
  } catch (err) {
    if (err instanceof UnfurlError) return { error: err.code };
    throw err;
  }
}
```

A runnable version is in [examples/preview-server.mjs](examples/preview-server.mjs).

### oEmbed

oEmbed discovery is always on: if the page links to an endpoint, it is in
`result.oEmbed.json` / `result.oEmbed.xml`. Pass `oEmbed: true` to also fetch
the JSON endpoint through the same guard and limits:

```ts
const r = await unfurl('https://videos.example/watch?v=abc', { oEmbed: true });
r.oEmbed?.data?.html; // the provider's embed HTML: sanitize or sandbox before rendering
r.oEmbed?.error; // set when only the oEmbed request failed; the rest of the result is valid
```

### Cancelling

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);
await unfurl(url, { signal: controller.signal }); // rejects with code ABORTED
```

## Output schema

`unfurl()` and `parseHtml()` return the same `UnfurlResult`. Arrays and
objects are always present (possibly empty); other fields are omitted when
the page does not provide them.

| Field           | Type                            | Notes                                                                    |
| --------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `url`           | `string`                        | Final URL after redirects (or the `baseUrl` given to `parseHtml`)        |
| `canonical`     | `string?`                       | `<link rel="canonical">`, else `og:url`                                  |
| `title`         | `string?`                       | See the precedence table below                                           |
| `description`   | `string?`                       |                                                                          |
| `siteName`      | `string?`                       |                                                                          |
| `type`          | `string?`                       | `og:type`, e.g. `article`, `video.other`                                 |
| `lang`          | `string?`                       | BCP 47 tag, e.g. `en-GB`                                                 |
| `themeColor`    | `string?`                       | The media-less or light-scheme `theme-color`                             |
| `author`        | `string?`                       |                                                                          |
| `publishedTime` | `string?`                       | As written by the page (usually ISO 8601)                                |
| `modifiedTime`  | `string?`                       |                                                                          |
| `keywords`      | `string[]`                      | `<meta name="keywords">`, split on commas                                |
| `favicon`       | `string`                        | Best icon; falls back to `/favicon.ico` on the page's origin             |
| `icons`         | `Icon[]`                        | `{ url, rel, size, sizes?, type? }`, best first                          |
| `images`        | `Media[]`                       | `{ url, width?, height?, type?, alt? }`                                  |
| `videos`        | `Media[]`                       | `og:video`                                                               |
| `audio`         | `Media[]`                       | `og:audio`                                                               |
| `feeds`         | `Feed[]`                        | RSS, Atom and JSON Feed links: `{ url, type, title? }`                   |
| `manifest`      | `string?`                       | Web app manifest URL                                                     |
| `oEmbed`        | `OEmbedInfo?`                   | `{ json?, xml?, title?, data?, error? }`                                 |
| `jsonLd`        | `JsonLdSummary?`                | `{ type?, types, headline?, description?, authors, datePublished?, dateModified?, image?, publisher?, url? }` |
| `openGraph`     | `Record<string, string \| string[]>` | Every `og:*` tag without the prefix; repeated tags become arrays    |
| `twitter`       | `Record<string, string>`        | Every `twitter:*` tag without the prefix (`card`, `site`, `player`, ...) |
| `response`      | `ResponseInfo?`                 | Only from `unfurl()`: `{ status, contentType?, charset, redirects, bytesRead, truncated }` |

Every URL in the result is absolute, resolved against `<base href>` and the
page URL, and is `http:` or `https:`. `javascript:`, `data:` and other
schemes are dropped.

Example (`parseHtml` on [test/fixtures/video.html](test/fixtures/video.html), abridged):

```json
{
  "url": "https://videosite.example/watch?v=abc123",
  "canonical": "https://videosite.example/watch?v=abc123",
  "title": "A video",
  "siteName": "VideoSite",
  "type": "video.other",
  "lang": "en",
  "themeColor": "rgba(255, 255, 255, 0.98)",
  "author": "Channel Name",
  "publishedTime": "2026-10-30",
  "favicon": "https://www.videosite.example/img/favicon_144x144.png",
  "images": [{ "url": "https://img.videosite.example/vi/abc123/maxresdefault.jpg", "width": 1280, "height": 720 }],
  "videos": [{ "url": "https://videosite.example/embed/abc123", "type": "text/html", "width": 1280, "height": 720 }],
  "oEmbed": {
    "json": "https://videosite.example/oembed?url=https%3A%2F%2Fvideosite.example%2Fwatch%3Fv%3Dabc123&format=json",
    "xml": "https://videosite.example/oembed?url=https%3A%2F%2Fvideosite.example%2Fwatch%3Fv%3Dabc123&format=xml",
    "title": "A video"
  },
  "jsonLd": { "type": "VideoObject", "types": ["VideoObject"], "headline": "A video", "authors": ["Channel Name"] },
  "twitter": { "card": "player", "player": "https://videosite.example/embed/abc123", "player:width": "1280" }
}
```

## What is extracted, and from where

The first source that has a value wins.

| Field           | 1st                         | 2nd                        | 3rd                        | 4th                          |
| --------------- | --------------------------- | -------------------------- | -------------------------- | ---------------------------- |
| `title`         | `og:title`                  | `twitter:title`            | JSON-LD `headline`/`name`  | `<title>`                    |
| `description`   | `og:description`            | `twitter:description`      | `<meta name=description>`  | JSON-LD `description`        |
| `siteName`      | `og:site_name`              | `application-name`         | JSON-LD `publisher`        |                              |
| `canonical`     | `<link rel=canonical>`      | `og:url`                   |                            |                              |
| `images`        | `og:image` (+ `:secure_url`, `:width`, `:height`, `:type`, `:alt`) | `twitter:image` (+ `:alt`) | JSON-LD `image`/`thumbnailUrl` |      |
| `author`        | `<meta name=author>`        | JSON-LD `author` (names, `@id` resolved) | `article:author` (if not a URL) | `twitter:creator` |
| `publishedTime` | `article:published_time`    | JSON-LD `datePublished`/`uploadDate` |                  |                              |
| `modifiedTime`  | `article:modified_time`     | `og:updated_time`          | JSON-LD `dateModified`     |                              |
| `lang`          | `<html lang>`               | `Content-Language` meta    | `og:locale` (`en_US` to `en-US`) |                        |
| `themeColor`    | `theme-color` without `media` | `theme-color` for light  | first `theme-color`        |                              |
| `favicon`       | largest declared icon (SVG counts as largest) | `apple-touch-icon` (180) | `icon` (32, `.ico` 16) | `/favicon.ico`       |
| `oEmbed`        | `<link rel=alternate type=application/json+oembed>` | `text/xml+oembed` |               |                              |

How this compares with simpler approaches:

| Source                                     | url-unfurl | Typical Open Graph scraper | Fetch + `<title>` regex |
| ------------------------------------------ | :--------: | :------------------------: | :---------------------: |
| Open Graph (incl. structured `og:image:*`) | yes        | partial                    | no                      |
| Twitter cards                              | yes        | sometimes                  | no                      |
| `<title>` / meta description               | yes        | sometimes                  | title only              |
| oEmbed discovery                           | yes        | no                         | no                      |
| oEmbed fetch                               | opt-in     | no                         | no                      |
| JSON-LD (type, author, dates, publisher)   | yes        | no                         | no                      |
| Favicon / touch icon ranking               | yes        | no                         | no                      |
| `theme-color`, language, feeds, manifest   | yes        | no                         | no                      |
| Charset detection (header, BOM, meta)      | yes        | sometimes                  | no                      |
| Entities decoded, relative URLs resolved   | yes        | sometimes                  | no                      |
| SSRF guard with DNS and redirect checks    | yes        | rarely                     | no                      |
| Byte limit and stop at `</head>`           | yes        | rarely                     | no                      |

These are the same sources chat apps such as Slack and Discord read for
their previews, so a page that looks right here usually looks right there.

## Options

All options are optional.

| Option                 | Default            | Meaning                                                                       |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `timeout`              | `8000`             | Total budget in ms for DNS, redirects, headers and body                       |
| `maxBytes`             | `524288`           | Stop reading the body after this many bytes (`response.truncated` is set)     |
| `maxRedirects`         | `5`                | Redirects to follow; each one is checked by the guard                         |
| `stopAtHeadEnd`        | `true`             | Stop reading at `</head>` or `<body`. Set `false` to also see JSON-LD in the body |
| `oEmbed`               | `false`            | Fetch the discovered oEmbed JSON (max 64 KiB, same guard)                     |
| `userAgent`            | `url-unfurl/<version> (+repo URL)` | Some sites serve richer tags to known bots; set your own name  |
| `acceptLanguage`       | `en`               | `Accept-Language` header                                                      |
| `headers`              | `{}`               | Extra request headers                                                         |
| `allowedPorts`         | any                | For example `[80, 443]`                                                       |
| `allowPrivateNetworks` | `false`            | Turn the address checks off. Only for trusted input                           |
| `allowAddress`         | none               | `(address, hostname) => boolean`: allow specific blocked addresses            |
| `lookup`               | `dns.promises.lookup` (`all: true`) | Custom resolver, e.g. for tests or DNS-over-HTTPS              |
| `fetch`                | global `fetch`     | Custom fetch, e.g. one that goes through an egress proxy                      |
| `signal`               | none               | `AbortSignal` to cancel                                                       |
| `cache`                | none               | Any `{ get, set }`, e.g. `new LruCache({ max, ttl })` or a `Map`              |

## Errors

`unfurl()` only rejects with `UnfurlError`, which has `code`, `message`,
`url` (the URL being fetched) and, for HTTP errors, `status`.

| Code                       | When                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| `INVALID_URL`              | The input is not a URL                                                      |
| `BLOCKED_URL`              | Not http(s), has credentials, a disallowed port, or resolves to a non-public address |
| `DNS_ERROR`                | The hostname does not resolve                                               |
| `TIMEOUT`                  | The total `timeout` elapsed                                                 |
| `ABORTED`                  | The caller's `signal` fired                                                 |
| `TOO_MANY_REDIRECTS`       | More than `maxRedirects`                                                    |
| `HTTP_ERROR`               | A non-2xx status (`err.status`)                                             |
| `UNSUPPORTED_CONTENT_TYPE` | The response is not `text/html` or `application/xhtml+xml`                  |
| `FETCH_FAILED`             | Connection errors, redirects without `Location`, other network failures     |

`parseHtml()` never throws for any HTML input; it throws a `TypeError` only
if `baseUrl` is not a valid absolute URL.

## CLI

```console
$ npx @saizul/url-unfurl https://example.com --json
$ npx @saizul/url-unfurl https://videos.example/watch?v=abc --oembed
$ npx @saizul/url-unfurl --file saved.html --base https://example.com/page
```

| Flag                    | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `--json`                | Print the full `UnfurlResult` as JSON                           |
| `--oembed`              | Also fetch the oEmbed JSON                                      |
| `--timeout <ms>`        | Total time budget                                               |
| `--max-bytes <n>`       | Body byte limit                                                 |
| `--max-redirects <n>`   | Redirect limit                                                  |
| `--user-agent <text>`   | `User-Agent` header                                             |
| `--full-body`           | Keep reading after `</head>` (up to `--max-bytes`)              |
| `--allow-private`       | Allow private and loopback addresses, e.g. for a local dev server |
| `--file <path>`         | Parse a local file instead of fetching                          |
| `--base <url>`          | Base URL for `--file`                                           |

Exit codes: `0` success, `1` the URL could not be unfurled (the error code is
printed, and with `--json` also written as `{"error": {"code", "message"}}`),
`2` invalid arguments.

## Security

Fetching a URL that a user typed is a classic server-side request forgery
(SSRF) risk: without care, a chat message containing
`http://169.254.169.254/latest/meta-data/` makes your server read its own
cloud credentials. url-unfurl defends against this by default:

- **Only `http:` and `https:`**, no credentials in the URL, optional port
  allowlist (`allowedPorts: [80, 443]` is recommended for public services).
- **Every address is checked.** The hostname is resolved with `all: true`
  and the request is refused if *any* record is non-public, so a
  round-robin record with one internal address is not a way in.
- **Blocked ranges** include `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT),
  `127/8`, `169.254/16` (link-local and cloud metadata), `172.16/12`,
  `192.168/16`, `192.0.0/24`, documentation and benchmarking ranges,
  multicast and `240/4`; on IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`,
  `fec0::/10`, multicast, documentation, Teredo, and any IPv6 address that
  embeds a blocked IPv4 address (`::ffff:127.0.0.1`, NAT64 `64:ff9b::/96`,
  6to4 `2002::/16`).
- **Every notation of an IP literal** that the WHATWG URL parser accepts is
  normalized before the check (`http://2130706433/`, `http://0x7f.1/`,
  `http://[::ffff:7f00:1]/`), and `localhost` / `*.localhost` are blocked
  without asking DNS.
- **Redirects are followed manually**, and every hop goes through the same
  checks. A public page that redirects to an internal address is refused.
- **Resource limits**: one total timeout that also covers DNS and slow
  bodies, a redirect limit, a byte limit, and reading stops at `</head>`.
  Non-HTML responses are refused before the body is read.
- **Untrusted output**: titles and descriptions are plain text with entities
  decoded, so **escape them when you render HTML**. `oEmbed.data.html` is
  the provider's markup: sanitize it or put it in a sandboxed iframe.

**Known limitation: DNS rebinding.** The guard resolves the hostname, then
`fetch` resolves it again to connect. An attacker who controls DNS for a
domain can answer the first query with a public address and the second with
a private one. Node's global `fetch` offers no public hook to pin the
connection to a checked address. If your threat model includes this, run
unfurling in a network that cannot reach internal services, or pass a
`fetch` that goes through an egress proxy which enforces the same rules.

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## API

| Export                                     | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `unfurl(url, options?)`                    | Fetch and parse; resolves to `UnfurlResult`                    |
| `parseHtml(html, baseUrl)`                 | Parse HTML you already have; no network                        |
| `LruCache`                                 | `new LruCache({ max?, ttl?, now? })` with `get/set/has/delete/clear/size` |
| `UnfurlError`                              | The error class, with `code`, `url`, `status`                  |
| `assertSafeUrl(url, options?)`             | The SSRF guard on its own, for your own fetches                |
| `isPrivateAddress(ip)`                     | True for any non-public IPv4/IPv6 address                      |
| `scanHtml(html)`                           | The low-level tag scanner (`meta`, `link`, `base`, title, JSON-LD) |
| `summarizeJsonLd(blocks)`                  | JSON-LD summary from raw script contents                       |
| `decodeEntities(text)`                     | HTML entity decoder                                            |
| `detectCharset(bytes, header?)`, `charsetFromContentType(value)` | Charset helpers                          |
| `cacheKey(url)`                            | The key `unfurl` uses for the cache (URL without fragment)     |
| `DEFAULTS`, `VERSION`                      | Default limits and the package version                         |
| `UnfurlResult`, `UnfurlOptions`, `Media`, `Icon`, `Feed`, `OEmbedInfo`, `OEmbedData`, `JsonLdSummary`, `ResponseInfo`, `CacheLike`, `LookupFunction` | Types |

## FAQ

**Why not use cheerio or jsdom?** Link previews only need a handful of tags
from the `<head>`. A dedicated scanner is small, has no dependencies, runs in
linear time on hostile input and is easy to audit. If you need the full DOM,
fetch with `assertSafeUrl` and parse with the library of your choice.

**Why is `title` different from what my browser tab shows?** Previews prefer
`og:title`, which sites write for sharing. The `<title>` is the last
fallback. All sources are still available in `openGraph` and `twitter`.

**A site returns a 403 or an empty page.** Some sites block unknown user
agents or serve tags only to known crawlers. Set `userAgent` to something
that identifies your service and includes a URL. Do not impersonate other
companies' bots.

**JSON-LD is missing on some pages.** Many sites put JSON-LD at the end of
`<body>`. By default reading stops at `</head>`; pass `stopAtHeadEnd: false`
(CLI: `--full-body`) and a large enough `maxBytes`.

**Can I unfurl my local dev server?** Yes: `allowPrivateNetworks: true`
(CLI: `--allow-private`), or `allowAddress: (a) => a === '127.0.0.1'` to be
precise. Never enable this for URLs from users.

**Does it run in browsers, Deno, Bun or edge runtimes?** The scanner and
extractor behind `parseHtml` are plain TypeScript with no Node APIs, but the
package entry also loads the guard, which imports `node:dns` and `node:net`.
Node 20+ is what CI tests; a browser-safe `@saizul/url-unfurl/parse`
subpath export is on the roadmap.

**Does it execute JavaScript?** No. Pages that only add their meta tags with
client-side JavaScript will look empty, just like they do for Slack.

**Is the cache shared between options?** The key is the URL without its
fragment. Use separate caches if you call `unfurl` with different options
(for example with and without `oEmbed`).

## Roadmap

Items marked **good first issue** are small and self-contained;
[CONTRIBUTING.md](CONTRIBUTING.md) has pointers for each.

- Direct links to images and videos: return a preview with `images: [{ url }]`
  instead of `UNSUPPORTED_CONTENT_TYPE` (**good first issue**)
- Use microdata `itemprop="name"` and `itemprop="image"` as the last
  fallbacks for the title and image (**good first issue**)
- Use `twitter:player` as a video when there is no `og:video`
  (**good first issue**)
- `msapplication-TileColor` and `msapplication-TileImage` as theme color and
  icon fallbacks (**good first issue**)
- A `--fields title,description,image` option for the CLI (**good first issue**)
- Fall back to the first `<h1>` and first `<p>` when there is no title or
  description, behind an option (**good first issue**)
- Fetch the oEmbed XML endpoint when there is no JSON endpoint
- A connection-pinned fetch (custom `lookup` at connect time) to close the
  DNS rebinding gap
- Optional in-flight request de-duplication for the cache
- A built-in provider list for oEmbed endpoints that sites do not advertise
- A browser-safe `./parse` subpath export with only `parseHtml` and helpers
- Bun and Deno in the CI matrix

## Contributing

Contributions of every size are welcome, and first-timers especially. The
codebase is small: the scanner, the extractor, the guard and the fetcher are
one file each. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and a list of
beginner-friendly issues, and the [code of conduct](CODE_OF_CONDUCT.md).

```console
$ git clone https://github.com/saizul/url-unfurl.git && cd url-unfurl
$ npm ci
$ npm test     # offline: fixtures, a local server and a fake DNS resolver
$ npm run lint
```

Adding support for a new tag usually means: a few lines in
[src/html/extract.ts](src/html/extract.ts), a field in
[src/types.ts](src/types.ts), an HTML snippet in a test, and a row in the
tables above.

## License

[MIT](LICENSE) © 2026 Saizul Amin
