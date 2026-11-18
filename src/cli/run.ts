import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { UnfurlError } from '../errors.js';
import { parseHtml } from '../html/extract.js';
import type { UnfurlOptions, UnfurlResult } from '../types.js';
import { unfurl } from '../unfurl.js';
import { VERSION } from '../version.js';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Replaces `unfurl()`, for tests. */
  unfurl?: typeof unfurl;
}

export const HELP = `url-unfurl ${VERSION}

Fetch a URL and print link-preview metadata (title, description, image,
favicon, Open Graph, Twitter card, oEmbed, JSON-LD).

Usage
  url-unfurl <url> [options]
  url-unfurl --file page.html --base https://example.com/page [options]

Options
  --json                 Print the full result as JSON
  --oembed               Also fetch the oEmbed JSON endpoint, if the page has one
  --timeout <ms>         Total time budget (default 8000)
  --max-bytes <n>        Stop reading the body after n bytes (default 524288)
  --max-redirects <n>    Maximum redirects to follow (default 5)
  --user-agent <text>    User-Agent header
  --full-body            Keep reading after </head> (up to --max-bytes)
  --allow-private        Allow private and loopback addresses (trusted input only)
  --file <path>          Parse a local HTML file instead of fetching
  --base <url>           Base URL for --file (default https://example.invalid/)
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes
  0  success
  1  the URL could not be unfurled (blocked, timeout, HTTP error, not HTML)
  2  invalid arguments
`;

function positiveInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a non-negative integer`);
  return n;
}

class UsageError extends Error {}

/** Formats a result as aligned "label  value" lines, skipping empty fields. */
export function formatPretty(r: UnfurlResult): string {
  const image = r.images[0];
  const rows: Array<[string, string | undefined]> = [
    ['Title', r.title],
    ['Description', r.description],
    ['Site', r.siteName],
    ['URL', r.url],
    ['Canonical', r.canonical !== r.url ? r.canonical : undefined],
    ['Type', r.type],
    ['Author', r.author],
    ['Published', r.publishedTime],
    [
      'Image',
      image && `${image.url}${image.width && image.height ? ` (${image.width}x${image.height})` : ''}`,
    ],
    ['Video', r.videos[0]?.url],
    ['Favicon', r.favicon],
    ['Theme color', r.themeColor],
    ['Language', r.lang],
    ['Twitter card', r.twitter.card],
    ['oEmbed', r.oEmbed?.json ?? r.oEmbed?.xml],
    ['oEmbed type', r.oEmbed?.data?.type],
    ['JSON-LD', r.jsonLd?.type],
    ['Redirects', r.response?.redirects.length ? r.response.redirects.join(' -> ') : undefined],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows
    .filter((row): row is [string, string] => row[1] !== undefined && row[1] !== '')
    .map(([k, v]) => `${k.padEnd(width)}  ${v}\n`)
    .join('');
}

/** Runs the CLI and resolves with the exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    io.stderr(
      `url-unfurl: ${err instanceof Error ? err.message : String(err)}\nRun "url-unfurl --help" for usage.\n`,
    );
    return 2;
  }
  const { values, url } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  let options: UnfurlOptions;
  try {
    options = {
      timeout: positiveInt('timeout', values.timeout),
      maxBytes: positiveInt('max-bytes', values['max-bytes']),
      maxRedirects: positiveInt('max-redirects', values['max-redirects']),
      oEmbed: values.oembed === true,
      stopAtHeadEnd: values['full-body'] !== true,
      allowPrivateNetworks: values['allow-private'] === true,
    };
    if (values['user-agent']) options.userAgent = values['user-agent'];
    for (const k of Object.keys(options) as Array<keyof UnfurlOptions>) {
      if (options[k] === undefined) delete options[k];
    }
    if (values.file === undefined && url === undefined) throw new UsageError('missing <url>');
    if (values.file !== undefined && url !== undefined) throw new UsageError('use either <url> or --file');
  } catch (err) {
    io.stderr(
      `url-unfurl: ${err instanceof Error ? err.message : String(err)}\nRun "url-unfurl --help" for usage.\n`,
    );
    return 2;
  }

  let result: UnfurlResult;
  try {
    if (values.file !== undefined) {
      result = parseHtml(readFileSync(values.file, 'utf8'), values.base ?? 'https://example.invalid/');
    } else {
      result = await (io.unfurl ?? unfurl)(url!, options);
    }
  } catch (err) {
    if (err instanceof UnfurlError) {
      if (values.json)
        io.stdout(`${JSON.stringify({ error: { code: err.code, message: err.message } }, null, 2)}\n`);
      io.stderr(`url-unfurl: ${err.code}: ${err.message}\n`);
      return 1;
    }
    if (values.file !== undefined) {
      io.stderr(`url-unfurl: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    throw err;
  }
  io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatPretty(result));
  return 0;
}

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean' },
      oembed: { type: 'boolean' },
      timeout: { type: 'string' },
      'max-bytes': { type: 'string' },
      'max-redirects': { type: 'string' },
      'user-agent': { type: 'string' },
      'full-body': { type: 'boolean' },
      'allow-private': { type: 'boolean' },
      file: { type: 'string' },
      base: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (positionals.length > 1) throw new UsageError('expected a single <url>');
  return { values, url: positionals[0] };
}
