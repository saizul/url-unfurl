import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UnfurlError } from '../errors.js';
import type { LookupFunction } from '../types.js';
import { isPrivateAddress } from './ip.js';

export interface GuardOptions {
  allowPrivateNetworks?: boolean;
  allowAddress?: (address: string, hostname: string) => boolean;
  allowedPorts?: number[];
  lookup?: LookupFunction;
}

const defaultLookup: LookupFunction = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Parses a URL and checks the parts that do not need DNS. Throws `UnfurlError`. */
export function parseTarget(input: string | URL, options: GuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch (cause) {
    throw new UnfurlError('INVALID_URL', `Not a valid URL: ${String(input)}`, { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnfurlError('BLOCKED_URL', `Only http and https URLs are allowed, got ${url.protocol}`, {
      url: url.href,
    });
  }
  if (url.username || url.password) {
    throw new UnfurlError('BLOCKED_URL', 'URLs with credentials are not allowed', { url: url.href });
  }
  if (options.allowedPorts) {
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!options.allowedPorts.includes(port)) {
      throw new UnfurlError('BLOCKED_URL', `Port ${port} is not allowed`, { url: url.href });
    }
  }
  return url;
}

/** The hostname without IPv6 brackets or a trailing dot. */
export function bareHostname(url: URL): string {
  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host.toLowerCase();
}

/**
 * Resolves the URL's hostname and throws `BLOCKED_URL` if any address it
 * resolves to is private, loopback, link-local or otherwise not public.
 * Checking every address (not just the first) stops round-robin tricks
 * where one record is public and another points inside the network.
 */
export async function assertSafeUrl(input: string | URL, options: GuardOptions = {}): Promise<URL> {
  const url = parseTarget(input, options);
  if (options.allowPrivateNetworks) return url;
  const host = bareHostname(url);

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else if (host === 'localhost' || host.endsWith('.localhost')) {
    addresses = ['127.0.0.1', '::1'];
  } else {
    let records: Array<{ address: string }>;
    try {
      records = await (options.lookup ?? defaultLookup)(host);
    } catch (cause) {
      throw new UnfurlError('DNS_ERROR', `Could not resolve ${host}`, { url: url.href, cause });
    }
    addresses = records.map((r) => r.address);
    if (addresses.length === 0) {
      throw new UnfurlError('DNS_ERROR', `${host} has no addresses`, { url: url.href });
    }
  }

  for (const address of addresses) {
    if (isPrivateAddress(address) && !options.allowAddress?.(address, host)) {
      throw new UnfurlError('BLOCKED_URL', `${host} resolves to a non-public address (${address})`, {
        url: url.href,
      });
    }
  }
  return url;
}
