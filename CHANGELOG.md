# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-18

### Added

- `unfurl(url, options)`: fetches a page with the global `fetch` and returns
  link-preview metadata: title, description, canonical URL, site name, type,
  language, theme color, author, dates, keywords, favicon and ranked icons,
  images, videos, audio, feeds, manifest, Open Graph, Twitter cards, oEmbed
  discovery and a JSON-LD summary.
- `parseHtml(html, baseUrl)` for offline use, built on a small linear-time
  HTML head scanner (`scanHtml`) that understands comments, raw-text
  elements, attribute quoting and `<base href>`.
- SSRF guard (`assertSafeUrl`, `isPrivateAddress`): http(s) only, no
  credentials, optional port allowlist, every DNS record checked, private,
  loopback, link-local, CGNAT, multicast, documentation and reserved IPv4 and
  IPv6 ranges blocked, including IPv4-mapped, NAT64 and 6to4 forms; every
  redirect re-checked.
- Limits: total `timeout`, `maxRedirects`, `maxBytes`, stop reading at
  `</head>`, HTML-only content types, `AbortSignal` support.
- Charset detection from the BOM, the `Content-Type` header and
  `<meta charset>`; HTML entity decoding with windows-1252 C1 mapping.
- Optional oEmbed JSON fetch (`oEmbed: true`) through the same guard, with a
  64 KiB limit and sanitized fields.
- `LruCache` with `max` and `ttl`, usable as the `cache` option.
- `url-unfurl` CLI with human-readable and `--json` output, `--file` for
  local HTML, and exit codes 0, 1 and 2.
- ESM and CommonJS builds with type declarations; no runtime dependencies.

[Unreleased]: https://github.com/saizul/url-unfurl/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/saizul/url-unfurl/releases/tag/v0.1.0
