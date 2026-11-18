import { isIP } from 'node:net';

// IPv4 ranges that must never be fetched on behalf of a user: private,
// loopback, link-local (cloud metadata lives at 169.254.169.254), CGNAT,
// documentation, benchmarking, multicast and reserved space.
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function v4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

const V4_RANGES = V4_BLOCKED.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (v4ToInt(base)! & mask) >>> 0, mask };
});

function v4Blocked(n: number): boolean {
  return V4_RANGES.some((r) => (n & r.mask) >>> 0 === r.base);
}

/** Parses an IPv6 address into eight 16-bit groups. Accepts `::` and a trailing dotted IPv4 part. */
export function parseIPv6(input: string): number[] | undefined {
  let ip = input.trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (isIP(ip) !== 6) return undefined;

  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const last = ip.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = v4ToInt(last);
    if (v4 === undefined) return undefined;
    tail = [v4 >>> 16, v4 & 0xffff];
    ip = ip.slice(0, lastColon + 1);
    if (ip.endsWith(':') && !ip.endsWith('::')) ip = ip.slice(0, -1);
  }
  const halves = ip.split('::');
  if (halves.length > 2) return undefined;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':').map((g) => Number.parseInt(g, 16)));
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  const total = head.length + rest.length + tail.length;
  if (halves.length === 1 && total !== 8) return undefined;
  if (total > 8) return undefined;
  const zeros = halves.length === 2 ? new Array<number>(8 - total).fill(0) : [];
  const groups = [...head, ...zeros, ...rest, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : undefined;
}

function v6Blocked(g: number[]): boolean {
  const [a, b, c, d, e, f, h0, h1] = g as [number, number, number, number, number, number, number, number];
  const embedded = ((h0 << 16) | h1) >>> 0;
  const firstFiveZero = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (firstFiveZero && f === 0) return h0 === 0 || v4Blocked(embedded);
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-translated ::ffff:0:a.b.c.d
  if (firstFiveZero && f === 0xffff) return v4Blocked(embedded);
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0xffff && f === 0) return v4Blocked(embedded);
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address; 64:ff9b:1::/48 is local use.
  if (a === 0x64 && b === 0xff9b) return c === 1 || v4Blocked(embedded);
  // 6to4 2002::/16 embeds an IPv4 address in the second and third groups.
  if (a === 0x2002) return v4Blocked(((b << 16) | c) >>> 0);
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return true; // discard-only 100::/64
  if (a === 0x2001 && b === 0) return true; // Teredo 2001::/32 hides an IPv4 address
  if (a === 0x2001 && b === 2 && c === 0) return true; // benchmarking 2001:2::/48
  if (a === 0x2001 && (b & 0xfff0) === 0x10) return true; // ORCHID 2001:10::/28
  if (a === 0x2001 && (b & 0xfff0) === 0x20) return true; // ORCHIDv2 2001:20::/28
  if (a === 0x2001 && b === 0xdb8) return true; // documentation
  if ((a & 0xfff0) === 0x3ff0) return true; // documentation 3fff::/20
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * True when the address is not a public unicast address: private, loopback,
 * link-local, unique local, CGNAT, multicast, documentation, reserved, or an
 * IPv6 address that embeds such an IPv4 address (mapped, NAT64, 6to4).
 * Anything that is not a valid IP address also returns true.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim();
  const v4 = v4ToInt(ip);
  if (v4 !== undefined) return v4Blocked(v4);
  const v6 = parseIPv6(ip);
  if (v6) return v6Blocked(v6);
  return true;
}
