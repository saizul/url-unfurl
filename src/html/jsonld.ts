import type { JsonLdSummary } from '../types.js';

type Node = Record<string, unknown>;

// Types that describe the site or page furniture rather than the content.
const GENERIC = new Set([
  'WebSite',
  'WebPage',
  'Organization',
  'Corporation',
  'Person',
  'BreadcrumbList',
  'ListItem',
  'ImageObject',
  'SearchAction',
  'ReadAction',
  'SiteNavigationElement',
  'WPHeader',
  'WPFooter',
  'WPSideBar',
  'EntryPoint',
  'ContactPoint',
  'PostalAddress',
]);

function isNode(v: unknown): v is Node {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typesOf(node: Node): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^(?:https?:\/\/)?schema\.org\//, ''));
}

function clean(text: string): string {
  let s = text.trim();
  // Some sites wrap the JSON in an HTML comment or CDATA section.
  s = s.replace(/^<!--/, '').replace(/-->$/, '');
  s = s.replace(/^\/\/\s*<!\[CDATA\[/, '').replace(/\/\/\s*\]\]>$/, '');
  s = s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return s.trim();
}

function collect(value: unknown, out: Node[], depth: number): void {
  if (depth > 4) return;
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out, depth + 1);
    return;
  }
  if (!isNode(value)) return;
  if (Array.isArray(value['@graph'])) collect(value['@graph'], out, depth + 1);
  if ('@type' in value) out.push(value);
}

function text(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    return s === '' ? undefined : s;
  }
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** Parses every JSON-LD block and summarizes the most specific node. Invalid JSON is skipped. */
export function summarizeJsonLd(blocks: string[]): JsonLdSummary | undefined {
  const nodes: Node[] = [];
  for (const block of blocks) {
    try {
      collect(JSON.parse(clean(block)), nodes, 0);
    } catch {
      // Broken JSON-LD is common; ignore the block.
    }
  }
  if (nodes.length === 0) return undefined;

  const byId = new Map<string, Node>();
  for (const n of nodes) if (typeof n['@id'] === 'string') byId.set(n['@id'], n);
  const deref = (v: unknown): unknown => {
    if (isNode(v) && typeof v['@id'] === 'string' && Object.keys(v).length === 1)
      return byId.get(v['@id']) ?? v;
    return v;
  };
  const nameOf = (v: unknown): string | undefined => {
    const d = deref(v);
    if (isNode(d)) return text(d.name);
    return text(d);
  };
  const urlOf = (v: unknown): string | undefined => {
    const d = deref(Array.isArray(v) ? v[0] : v);
    if (isNode(d)) return text(d.url) ?? text(d.contentUrl);
    return text(d);
  };

  const types: string[] = [];
  for (const n of nodes) for (const t of typesOf(n)) if (!types.includes(t)) types.push(t);

  const primary =
    nodes.find((n) => typesOf(n).some((t) => !GENERIC.has(t))) ??
    nodes.find((n) => typesOf(n).includes('WebPage')) ??
    nodes[0]!;

  const authorValue = primary.author ?? primary.creator;
  const authors: string[] = [];
  for (const a of Array.isArray(authorValue) ? authorValue : [authorValue]) {
    const name = nameOf(a);
    if (name && !authors.includes(name)) authors.push(name);
  }

  const summary: JsonLdSummary = { types, authors };
  const set = <K extends keyof JsonLdSummary>(key: K, value: JsonLdSummary[K] | undefined) => {
    if (value !== undefined) summary[key] = value;
  };
  set('type', typesOf(primary)[0]);
  set('headline', text(primary.headline) ?? text(primary.name));
  set('description', text(primary.description));
  set('datePublished', text(primary.datePublished) ?? text(primary.uploadDate));
  set('dateModified', text(primary.dateModified));
  set('image', urlOf(primary.image ?? primary.thumbnailUrl));
  set('publisher', nameOf(primary.publisher));
  set('url', text(primary.url));
  return summary;
}
