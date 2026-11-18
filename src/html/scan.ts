import { decodeEntities } from './entities.js';

/** A start tag with lower-cased attribute names and decoded values. */
export interface Tag {
  name: string;
  attrs: Record<string, string>;
}

/** What the scanner keeps from a document: only what link previews need. */
export interface ScanResult {
  /** `<meta>`, `<link>` and `<base>` tags in document order. */
  tags: Tag[];
  /** The text of the first `<title>` outside of `<svg>`. */
  title?: string;
  /** Attributes of the `<html>` element. */
  htmlAttrs: Record<string, string>;
  /** Raw contents of `<script type="application/ld+json">` elements. */
  jsonLd: string[];
}

const KEEP = new Set(['meta', 'link', 'base']);
// Elements whose content is raw text: markup inside them is not parsed.
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes']);
const NAME_CHAR = /[^\s/>]/;
const WS = /\s/;
const closers = new Map<string, RegExp>();

function closer(name: string): RegExp {
  let re = closers.get(name);
  if (!re) {
    re = new RegExp(`</${name}[\\s/>]`, 'gi');
    closers.set(name, re);
  }
  return re;
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));
}

/**
 * Scans HTML for the tags a link preview needs. It is a forgiving tokenizer,
 * not a tree builder: comments, raw-text elements (`<script>`, `<style>`, ...)
 * and attribute quoting follow the HTML rules closely enough that markup
 * inside scripts or comments is never mistaken for real tags. It runs in
 * linear time and never throws.
 */
export function scanHtml(html: string): ScanResult {
  const result: ScanResult = { tags: [], htmlAttrs: {}, jsonLd: [] };
  const len = html.length;
  let svgDepth = 0;
  let i = 0;

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    i = lt + 1;
    const next = html[i];

    if (next === '!') {
      if (html.startsWith('--', i + 1)) {
        const end = html.indexOf('-->', i + 3);
        i = end === -1 ? len : end + 3;
      } else {
        const end = html.indexOf('>', i);
        i = end === -1 ? len : end + 1;
      }
      continue;
    }
    if (next === '?') {
      const end = html.indexOf('>', i);
      i = end === -1 ? len : end + 1;
      continue;
    }
    if (next === '/') {
      let j = i + 1;
      while (j < len && NAME_CHAR.test(html[j]!)) j++;
      if (html.slice(i + 1, j).toLowerCase() === 'svg' && svgDepth > 0) svgDepth--;
      const end = html.indexOf('>', j);
      i = end === -1 ? len : end + 1;
      continue;
    }
    if (!isLetter(next)) continue;

    // Start tag: name, then attributes.
    let j = i;
    while (j < len && NAME_CHAR.test(html[j]!)) j++;
    const name = html.slice(i, j).toLowerCase();
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    i = j;
    while (i < len) {
      const ch = html[i]!;
      if (ch === '>') {
        i++;
        break;
      }
      if (WS.test(ch)) {
        i++;
        continue;
      }
      if (ch === '/') {
        selfClosing = html[i + 1] === '>';
        i++;
        continue;
      }
      let k = i;
      // An attribute name may start with "=" but otherwise stops at it.
      if (html[k] === '=') k++;
      while (k < len && !WS.test(html[k]!) && html[k] !== '/' && html[k] !== '>' && html[k] !== '=') k++;
      const attrName = html.slice(i, k).toLowerCase();
      i = k;
      while (i < len && WS.test(html[i]!)) i++;
      let value = '';
      if (html[i] === '=') {
        i++;
        while (i < len && WS.test(html[i]!)) i++;
        const quote = html[i];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, i + 1);
          const stop = end === -1 ? len : end;
          value = html.slice(i + 1, stop);
          i = end === -1 ? len : end + 1;
        } else {
          let m = i;
          while (m < len && !WS.test(html[m]!) && html[m] !== '>') m++;
          value = html.slice(i, m);
          i = m;
        }
      }
      if (attrName && !(attrName in attrs)) attrs[attrName] = decodeEntities(value);
    }

    if (name === 'svg' && !selfClosing) svgDepth++;
    if (name === 'html') {
      for (const [k, v] of Object.entries(attrs)) if (!(k in result.htmlAttrs)) result.htmlAttrs[k] = v;
    } else if (KEEP.has(name)) {
      result.tags.push({ name, attrs });
    }

    if (RAW_TEXT.has(name) && !selfClosing && !(name === 'title' && svgDepth > 0)) {
      const re = closer(name);
      re.lastIndex = i;
      const m = re.exec(html);
      const contentEnd = m ? m.index : len;
      const content = html.slice(i, contentEnd);
      if (name === 'title' && result.title === undefined) {
        result.title = decodeEntities(content);
      } else if (name === 'script' && (attrs.type ?? '').trim().toLowerCase() === 'application/ld+json') {
        result.jsonLd.push(content);
      }
      if (m) {
        const end = html.indexOf('>', m.index);
        i = end === -1 ? len : end + 1;
      } else {
        i = len;
      }
    }
  }
  return result;
}
