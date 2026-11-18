// A deliberately small entity decoder: numeric references plus the named
// entities that actually show up in titles and descriptions.
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  times: '×',
  divide: '÷',
  iexcl: '¡',
  iquest: '¿',
  shy: '­',
  zwj: '‍',
  zwnj: '‌',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  prime: '′',
  larr: '←',
  rarr: '→',
  hearts: '♥',
  star: '☆',
  check: '✓',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  agrave: 'à',
  egrave: 'è',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  ntilde: 'ñ',
  ccedil: 'ç',
};

// Entities that browsers decode even without the trailing semicolon.
const LEGACY = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg']);

// Numeric references 128-159 (0x80-0x9F) are interpreted as windows-1252, like browsers do.
const C1: Record<number, number> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178,
};

const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,8})|#([0-9]{1,10})|([A-Za-z][A-Za-z0-9]{1,31}))(;?)/g;

function fromCodePoint(cp: number): string {
  const mapped = C1[cp] ?? cp;
  if (mapped === 0 || mapped > 0x10ffff || (mapped >= 0xd800 && mapped <= 0xdfff)) return '�';
  return String.fromCodePoint(mapped);
}

/** Decodes HTML character references in text or attribute values. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (match, hex: string, dec: string, name: string, semi: string) => {
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16));
    if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10));
    const value = NAMED[name];
    if (value === undefined) return match;
    if (semi === '' && !LEGACY.has(name)) return match;
    return value;
  });
}
