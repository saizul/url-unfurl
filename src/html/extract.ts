import type { Feed, Icon, Media, OEmbedInfo, UnfurlResult } from '../types.js';
import { summarizeJsonLd } from './jsonld.js';
import { scanHtml } from './scan.js';

const ICON_RELS = ['apple-touch-icon', 'apple-touch-icon-precomposed', 'shortcut icon', 'icon'];
const FEED_TYPES = new Set(['application/rss+xml', 'application/atom+xml', 'application/feed+json']);

function norm(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const s = value.replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
}

/** Resolves a URL against a base and keeps it only if it is http(s). */
export function resolveUrl(value: string | undefined, base: string): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  try {
    const u = new URL(v, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function int(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function iconSize(rel: string, sizes: string | undefined, type: string | undefined, url: string): number {
  const svg = type === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(url);
  if (sizes) {
    if (/\bany\b/i.test(sizes)) return svg ? 1024 : 512;
    let max = 0;
    for (const m of sizes.matchAll(/(\d+)\s*[xX]\s*(\d+)/g)) max = Math.max(max, Number(m[1]), Number(m[2]));
    if (max > 0) return max;
  }
  if (svg) return 1024;
  if (rel.startsWith('apple-touch-icon')) return 180;
  return /\.ico(?:$|[?#])/i.test(url) || type === 'image/x-icon' || type === 'image/vnd.microsoft.icon'
    ? 16
    : 32;
}

function toLang(value: string | undefined): string | undefined {
  const v = norm(value)?.split(',')[0]?.trim();
  if (!v) return undefined;
  const tag = v.replace(/_/g, '-');
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : undefined;
}

type MediaKind = 'image' | 'video' | 'audio';

/**
 * Extracts link-preview metadata from an HTML string. Works offline: nothing
 * is fetched. Relative URLs are resolved against `<base href>` and then
 * `baseUrl`, and only http(s) URLs are kept.
 */
export function parseHtml(html: string, baseUrl: string): UnfurlResult {
  const page = new URL(baseUrl).href;
  const scan = scanHtml(html);
  let base = page;
  const baseTag = scan.tags.find((t) => t.name === 'base' && t.attrs.href);
  if (baseTag) base = resolveUrl(baseTag.attrs.href, page) ?? page;

  const openGraph: Record<string, string | string[]> = {};
  const twitter: Record<string, string> = {};
  const named: Record<string, string> = {};
  const media: Record<MediaKind, Array<Partial<Media> & { secure?: string }>> = {
    image: [],
    video: [],
    audio: [],
  };
  const themeColors: Array<{ color: string; media?: string }> = [];
  const icons: Icon[] = [];
  const feeds: Feed[] = [];
  let canonical: string | undefined;
  let manifest: string | undefined;
  let contentLanguage: string | undefined;
  const oEmbed: OEmbedInfo = {};

  for (const { name, attrs } of scan.tags) {
    if (name === 'meta') {
      const content = attrs.content;
      if (attrs['http-equiv']?.toLowerCase() === 'content-language') contentLanguage ??= content;
      const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.trim().toLowerCase();
      if (!key || content === undefined) continue;
      const value = norm(content);
      if (value === undefined) continue;

      if (key.startsWith('og:')) {
        const prop = key.slice(3);
        const prev = openGraph[prop];
        openGraph[prop] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
        const [kind, sub] = prop.split(':') as [string, string | undefined];
        if (kind === 'image' || kind === 'video' || kind === 'audio') {
          const list = media[kind];
          let current = list[list.length - 1];
          const starts =
            sub === undefined || (sub === 'url' && current?.url !== undefined && current.url !== value);
          if (starts || !current) {
            current = {};
            list.push(current);
          }
          if (sub === undefined || sub === 'url') current.url ??= value;
          else if (sub === 'secure_url') current.secure ??= value;
          else if (sub === 'type') current.type ??= value;
          else if (sub === 'alt') current.alt ??= value;
          else if (sub === 'width') current.width ??= int(value);
          else if (sub === 'height') current.height ??= int(value);
        }
      } else if (key.startsWith('twitter:')) {
        const prop = key.slice(8);
        if (!(prop in twitter)) twitter[prop] = value;
      } else if (key === 'theme-color') {
        themeColors.push(attrs.media ? { color: value, media: attrs.media } : { color: value });
      } else if (!(key in named)) {
        named[key] = value;
      }
      continue;
    }

    if (name !== 'link' || !attrs.href) continue;
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const relText = rel.join(' ');
    const type = attrs.type?.trim().toLowerCase();
    const href = resolveUrl(attrs.href, base);
    if (!href) continue;

    if (rel.includes('canonical')) canonical ??= href;
    if (rel.includes('manifest')) manifest ??= href;
    if (rel.includes('alternate') && type) {
      if (type === 'application/json+oembed') {
        oEmbed.json ??= href;
        if (attrs.title) oEmbed.title ??= norm(attrs.title);
      } else if (type === 'text/xml+oembed' || type === 'application/xml+oembed') {
        oEmbed.xml ??= href;
      } else if (FEED_TYPES.has(type)) {
        const feed: Feed = { url: href, type };
        const title = norm(attrs.title);
        if (title) feed.title = title;
        feeds.push(feed);
      }
    }
    const iconRel = ICON_RELS.find((r) => (r.includes(' ') ? relText === r : rel.includes(r)));
    if (iconRel && !rel.includes('mask-icon')) {
      const icon: Icon = { url: href, rel: iconRel, size: iconSize(iconRel, attrs.sizes, type, href) };
      if (type) icon.type = type;
      if (attrs.sizes) icon.sizes = attrs.sizes.trim();
      if (!icons.some((i) => i.url === icon.url)) icons.push(icon);
    }
  }

  const rank = (i: Icon) => (i.rel.startsWith('apple-touch-icon') ? 1 : 0);
  icons.sort((a, b) => b.size - a.size || rank(b) - rank(a));

  const finishMedia = (kind: MediaKind): Media[] => {
    const out: Media[] = [];
    for (const m of media[kind]) {
      const url = resolveUrl(m.secure, base) ?? resolveUrl(m.url, base);
      if (!url || out.some((o) => o.url === url)) continue;
      const item: Media = { url };
      if (m.type) item.type = m.type;
      if (m.width) item.width = m.width;
      if (m.height) item.height = m.height;
      if (m.alt) item.alt = m.alt;
      out.push(item);
    }
    return out;
  };
  const images = finishMedia('image');
  if (images.length === 0) {
    const url = resolveUrl(twitter.image ?? twitter['image:src'], base);
    if (url) images.push(twitter['image:alt'] ? { url, alt: twitter['image:alt'] } : { url });
  }

  const jsonLd = summarizeJsonLd(scan.jsonLd);
  const og = (k: string): string | undefined => {
    const v = openGraph[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const notUrl = (v: string | undefined) => (v && !/^https?:\/\//i.test(v) ? v : undefined);

  const theme =
    themeColors.find((t) => !t.media) ??
    themeColors.find((t) => /light/i.test(t.media ?? '')) ??
    themeColors[0];

  if (images.length === 0 && jsonLd?.image) {
    const url = resolveUrl(jsonLd.image, base);
    if (url) images.push({ url });
  }

  // Built in a fixed order so that JSON output reads top-down; empty optional fields are removed.
  const result: UnfurlResult = {
    url: page,
    canonical: canonical ?? resolveUrl(og('url'), base),
    title: og('title') ?? twitter.title ?? jsonLd?.headline ?? norm(scan.title),
    description: og('description') ?? twitter.description ?? named.description ?? jsonLd?.description,
    siteName: og('site_name') ?? named['application-name'] ?? jsonLd?.publisher,
    type: og('type'),
    lang: toLang(scan.htmlAttrs.lang) ?? toLang(contentLanguage) ?? toLang(og('locale')),
    themeColor: theme?.color,
    author: named.author ?? jsonLd?.authors[0] ?? notUrl(named['article:author']) ?? notUrl(twitter.creator),
    publishedTime: named['article:published_time'] ?? jsonLd?.datePublished,
    modifiedTime: named['article:modified_time'] ?? og('updated_time') ?? jsonLd?.dateModified,
    keywords: (named.keywords ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    favicon: icons[0]?.url ?? new URL('/favicon.ico', page).href,
    icons,
    images,
    videos: finishMedia('video'),
    audio: finishMedia('audio'),
    feeds,
    manifest,
    oEmbed: oEmbed.json || oEmbed.xml ? oEmbed : undefined,
    jsonLd,
    openGraph,
    twitter,
  };
  for (const key of Object.keys(result) as Array<keyof UnfurlResult>) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}
