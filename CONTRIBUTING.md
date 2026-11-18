# Contributing

Thanks for helping improve url-unfurl. Bug reports with a page that unfurls
badly, support for more tags, security hardening, examples and documentation
fixes are all welcome. If you are new to open source, start with one of the
[beginner issues](#good-first-issues) below; each is small and comes with
pointers.

## Reporting a bug

Open an issue with:

- the URL (if it is public) or the smallest HTML snippet that shows the
  problem, plus the base URL
- the output you got (`url-unfurl <url> --json`) and what you expected
- your url-unfurl and Node versions (`node --version`)

**Do not paste private URLs, internal hostnames, cookies or tokens.** For a
security problem, use private reporting instead; see [SECURITY.md](SECURITY.md).

## Development setup

You need Node 20 or newer.

```console
$ git clone https://github.com/saizul/url-unfurl.git
$ cd url-unfurl
$ npm ci
$ npm test              # builds ESM + CJS, compiles the tests and runs node:test
$ npm run lint          # biome lint + tsc --noEmit
$ npm run format        # biome format --write
$ npm run format:check  # what CI runs
```

Try the CLI from the build:

```console
$ node dist/esm/cli.js --file test/fixtures/article.html --base https://news.example.com/a
$ node dist/esm/cli.js https://example.com --json
```

## Guidelines

- **Zero runtime dependencies.** Only the Node standard library. Development
  tools go in `devDependencies`.
- **Tests never touch the internet.** Use an HTML fixture in
  `test/fixtures/` or an inline snippet for parsing, the local `node:http`
  server from `serve()` in `test/helpers.ts` for HTTP behaviour, and
  `fakeDns()` for anything that resolves a hostname.
- **The guard is strict by default.** A change must never make a default
  `unfurl()` call reach a non-public address. New ranges or bypass fixes
  come with tests in `test/ssrf.test.ts`.
- **Linear time.** The scanner must stay linear on any input; avoid nested
  rescans and regexes with nested quantifiers on untrusted text.
- **Only http(s) URLs in the output**, always absolute.
- Every change comes with a test and a line in the `Unreleased` section of
  `CHANGELOG.md`. New result fields also need a row in the README tables
  (a test checks that every field is documented).

## Project layout

```text
src/
  html/scan.ts       linear-time tag scanner (meta, link, base, title, JSON-LD)
  html/entities.ts   HTML entity decoder
  html/extract.ts    parseHtml(): precedence rules, media, icons, oEmbed links
  html/jsonld.ts     JSON-LD summary
  safety/ip.ts       isPrivateAddress() for IPv4 and IPv6
  safety/guard.ts    assertSafeUrl(): protocol, credentials, ports, DNS
  unfurl.ts          fetching: redirects, limits, timeout, oEmbed, cache
  charset.ts         charset detection and decoding
  cache.ts           LruCache
  cli.ts, cli/       command-line interface
test/
  fixtures/          HTML pages used by the tests
  helpers.ts         fixture(), serve(), fakeDns()
examples/            runnable examples
```

## Good first issues

Each of these is a self-contained change of roughly 10 to 50 lines plus
tests. Comment on the issue (or open one) to claim it.

1. **Preview direct image links.** When the response is `image/*`, return a
   result with `images: [{ url, type }]` instead of throwing
   `UNSUPPORTED_CONTENT_TYPE`. Where: the `checkType` callback and the end of
   `unfurl()` in `src/unfurl.ts`. Test: a `/photo.png` route in
   `test/fetch.test.ts`.
2. **Microdata fallback.** `<meta itemprop="...">` is already read into
   the same table as `<meta name>`, but `itemprop="name"` and
   `itemprop="image"` (and `<link itemprop="image" href>`) are not used.
   Add them as the last fallbacks for `title` and `images` in
   `src/html/extract.ts`, with a snippet in `test/extract.test.ts`.
3. **Player cards as videos.** When a page has no `og:video` but has
   `twitter:player` (with `twitter:player:width` and `:height`), add it to
   `videos` with `type: 'text/html'`. Where: next to the Twitter image
   fallback in `src/html/extract.ts`.
4. **Windows tile metadata.** Use `msapplication-TileColor` as a
   `themeColor` fallback and `msapplication-TileImage` as an icon
   (size 144). Where: the meta loop and icon handling in
   `src/html/extract.ts`.
5. **`--fields` for the CLI.** `url-unfurl <url> --fields title,image`
   prints only those rows (or only those keys with `--json`). Where:
   `formatPretty()` and `parse()` in `src/cli/run.ts`; tests in
   `test/cli.test.ts`.
6. **More named entities.** Add entities that appear in real titles, for
   example `&rsaquo;`, `&lsaquo;`, `&dagger;`, `&permil;` and accented
   capitals such as `&Eacute;`, to `src/html/entities.ts`, with tests in
   `test/scan.test.ts`.
7. **Content fallback.** Behind a new `contentFallback: true` option, use
   the first `<h1>` as the title and the first `<p>` as the description when
   the page has neither. This needs a small addition to `scanHtml()` to
   capture text, and `stopAtHeadEnd` must be off for it to see the body.
8. **Document more edge cases.** Add fixtures for pages you have seen
   unfurl badly (anonymized, no real personal data) and either fix the
   behaviour or document it in the README FAQ.

Larger items, such as a connection-pinned fetch to close the DNS rebinding
gap, are listed in the README roadmap. Please open an issue to discuss the
design before starting on those.

## Pull requests

Keep them focused: one fix or feature per pull request. Describe what
changed and how you tested it; the template has a short checklist. CI runs
lint, format check and the tests on Node 20, 22 and 24 on Linux, and Node 22
on Windows and macOS.
