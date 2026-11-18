/** An image, video or audio file announced by Open Graph or Twitter card tags. */
export interface Media {
  /** Absolute http(s) URL. `og:*:secure_url` wins over the plain URL when present. */
  url: string;
  type?: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** A favicon or touch icon from a `<link>` tag. */
export interface Icon {
  url: string;
  /** The `rel` keyword that declared it: `icon`, `shortcut icon`, `apple-touch-icon` or `apple-touch-icon-precomposed`. */
  rel: string;
  type?: string;
  /** The raw `sizes` attribute, for example `32x32` or `any`. */
  sizes?: string;
  /** The largest declared edge in pixels, or an estimate when `sizes` is missing. */
  size: number;
}

/** A feed announced with `<link rel="alternate">`. */
export interface Feed {
  url: string;
  type: string;
  title?: string;
}

/** The fields of an oEmbed response that are useful for a preview. */
export interface OEmbedData {
  type?: string;
  version?: string;
  title?: string;
  author_name?: string;
  author_url?: string;
  provider_name?: string;
  provider_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  width?: number;
  height?: number;
  /** Embed HTML from the provider. Treat it as untrusted: sanitize or sandbox it before rendering. */
  html?: string;
  url?: string;
}

/** oEmbed endpoints discovered with `<link rel="alternate" type="application/json+oembed">`. */
export interface OEmbedInfo {
  /** The JSON endpoint, if any. */
  json?: string;
  /** The XML endpoint, if any. */
  xml?: string;
  /** The discovery link's `title` attribute. */
  title?: string;
  /** The fetched JSON response, when `oEmbed: true` was passed to `unfurl()`. */
  data?: OEmbedData;
  /** Why fetching the oEmbed response failed. The rest of the result is still valid. */
  error?: string;
}

/** A summary of the most relevant JSON-LD (schema.org) node on the page. */
export interface JsonLdSummary {
  /** The first `@type` of the chosen node, for example `NewsArticle`. */
  type?: string;
  /** Every `@type` found in every JSON-LD block, in document order, without duplicates. */
  types: string[];
  /** `headline`, falling back to `name`. */
  headline?: string;
  description?: string;
  /** Author names; `@id` references inside the same document are resolved. */
  authors: string[];
  datePublished?: string;
  dateModified?: string;
  image?: string;
  publisher?: string;
  url?: string;
}

/** Details about the HTTP exchange. Only present on results from `unfurl()`. */
export interface ResponseInfo {
  status: number;
  /** The media type without parameters, for example `text/html`. */
  contentType?: string;
  /** The character encoding used to decode the body. */
  charset: string;
  /** Every URL that was redirected to, in order. Empty when there were no redirects. */
  redirects: string[];
  /** How many body bytes were read. */
  bytesRead: number;
  /** True when reading stopped at `maxBytes` before the end of `<head>`. */
  truncated: boolean;
}

/** Link-preview metadata for one page. */
export interface UnfurlResult {
  /** The page URL: the final URL after redirects, or the base URL given to `parseHtml()`. */
  url: string;
  /** `<link rel="canonical">`, falling back to `og:url`. */
  canonical?: string;
  /** `og:title`, `twitter:title`, JSON-LD `headline`, then `<title>`. */
  title?: string;
  /** `og:description`, `twitter:description`, `<meta name="description">`, then JSON-LD. */
  description?: string;
  /** `og:site_name`, `application-name`, then the JSON-LD publisher. */
  siteName?: string;
  /** `og:type`, for example `article` or `video.other`. */
  type?: string;
  /** `<html lang>`, `Content-Language`, then `og:locale` (as a BCP 47 tag). */
  lang?: string;
  /** `<meta name="theme-color">`; the light-scheme or media-less value is preferred. */
  themeColor?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  keywords: string[];
  /** The best icon (see `icons`), falling back to `/favicon.ico` on the page's origin. */
  favicon: string;
  /** Every icon, best first: larger declared sizes, SVG, then touch icons. */
  icons: Icon[];
  /** `og:image` entries, or the Twitter card image when there are none. */
  images: Media[];
  videos: Media[];
  audio: Media[];
  feeds: Feed[];
  manifest?: string;
  /** Every `og:*` tag. Repeated properties become arrays. */
  openGraph: Record<string, string | string[]>;
  /** Every `twitter:*` tag (first value wins), keyed without the prefix: `card`, `site`, `creator`, ... */
  twitter: Record<string, string>;
  oEmbed?: OEmbedInfo;
  jsonLd?: JsonLdSummary;
  response?: ResponseInfo;
}

/** A minimal cache interface. `LruCache` implements it; so does a `Map`. */
export interface CacheLike<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
}

/** Resolves a hostname to every address. Used by the SSRF guard. */
export type LookupFunction = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** Options for `unfurl()`. Every option is optional. */
export interface UnfurlOptions {
  /** Total time budget for the whole operation in milliseconds, redirects included. Default 8000. */
  timeout?: number;
  /** Stop reading the body after this many bytes. Default 524288 (512 KiB). */
  maxBytes?: number;
  /** Maximum number of redirects to follow. Default 5. */
  maxRedirects?: number;
  /** Stop reading as soon as `</head>` or `<body` is seen. Default true. */
  stopAtHeadEnd?: boolean;
  /** Fetch the discovered oEmbed JSON endpoint (through the same guard). Default false. */
  oEmbed?: boolean;
  /** Sent as `User-Agent`. */
  userAgent?: string;
  /** Sent as `Accept-Language`. Default `en`. */
  acceptLanguage?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Disable the private-address checks entirely. Only for trusted input. Default false. */
  allowPrivateNetworks?: boolean;
  /** Allow specific addresses that the guard would block, for example an internal proxy. */
  allowAddress?: (address: string, hostname: string) => boolean;
  /** Only allow these ports. Default: any port. `[80, 443]` is a good choice for public services. */
  allowedPorts?: number[];
  /** DNS resolver used by the guard. Default `dns.promises.lookup` with `all: true`. */
  lookup?: LookupFunction;
  /** The fetch implementation. Default the global `fetch`. */
  fetch?: typeof fetch;
  /** Cancels the operation. */
  signal?: AbortSignal;
  /** Results are read from and written to this cache, keyed by the URL without its fragment. */
  cache?: CacheLike<UnfurlResult>;
}
