import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeUrl, isPrivateAddress, UnfurlError, unfurl } from '../src/index.js';
import { fakeDns } from './helpers.js';

const BLOCKED = [
  '0.0.0.0',
  '10.1.2.3',
  '100.64.0.1',
  '127.0.0.1',
  '127.255.255.254',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.8',
  '192.0.2.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.51.100.7',
  '203.0.113.9',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '[::1]',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:10.0.0.1',
  '::ffff:0:192.168.0.1',
  '::127.0.0.1',
  '64:ff9b::a9fe:a9fe',
  '64:ff9b:1::1',
  '2002:c0a8:0101::1',
  '2001::1',
  '2001:db8::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'fe80::1%eth0',
  'febf::1',
  'fec0::1',
  'ff02::1',
  '100::1',
  'not-an-ip',
  '',
  '1.2.3',
  '256.1.1.1',
];

const PUBLIC = [
  '1.1.1.1',
  '8.8.8.8',
  '93.184.216.34',
  '172.32.0.1',
  '192.169.0.1',
  '100.128.0.1',
  '2606:4700:4700::1111',
  '2a00:1450:4001:80b::200e',
  '::ffff:8.8.8.8',
  '64:ff9b::808:808',
  '2002:0808:0808::1',
];

describe('isPrivateAddress', () => {
  for (const ip of BLOCKED) it(`blocks ${ip || '(empty)'}`, () => assert.equal(isPrivateAddress(ip), true));
  for (const ip of PUBLIC) it(`allows ${ip}`, () => assert.equal(isPrivateAddress(ip), false));
});

async function rejectsWith(promise: Promise<unknown>, code: string, pattern?: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof UnfurlError, `expected UnfurlError, got ${String(err)}`);
    assert.equal(err.code, code);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

describe('assertSafeUrl', () => {
  const lookup = fakeDns({
    'public.test': ['93.184.216.34'],
    'internal.test': ['10.0.0.5'],
    'mixed.test': ['93.184.216.34', '192.168.0.10'],
    'v6.test': ['2606:4700::1', 'fd00::1'],
    'metadata.test': ['169.254.169.254'],
    'empty.test': [],
  });

  it('allows a host that resolves to public addresses only', async () => {
    const url = await assertSafeUrl('https://public.test/a', { lookup });
    assert.equal(url.href, 'https://public.test/a');
  });

  it('blocks hosts that resolve to private addresses, checking every record', async () => {
    await rejectsWith(assertSafeUrl('http://internal.test/', { lookup }), 'BLOCKED_URL', /10\.0\.0\.5/);
    await rejectsWith(assertSafeUrl('http://mixed.test/', { lookup }), 'BLOCKED_URL', /192\.168\.0\.10/);
    await rejectsWith(assertSafeUrl('http://v6.test/', { lookup }), 'BLOCKED_URL', /fd00::1/);
    await rejectsWith(assertSafeUrl('http://metadata.test/latest/meta-data', { lookup }), 'BLOCKED_URL');
  });

  it('blocks IP literals in every notation the URL parser accepts', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://169.254.169.254/',
      'http://0/',
    ]) {
      await rejectsWith(assertSafeUrl(url, { lookup }), 'BLOCKED_URL');
    }
  });

  it('blocks localhost names without asking DNS', async () => {
    const neverCalled = async () => {
      throw new Error('lookup must not be called');
    };
    for (const url of ['http://localhost/', 'http://LOCALHOST./', 'http://app.localhost:3000/']) {
      await rejectsWith(assertSafeUrl(url, { lookup: neverCalled }), 'BLOCKED_URL');
    }
  });

  it('rejects non-http protocols, credentials and disallowed ports', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://public.test/',
      'gopher://public.test/',
      'data:text/html,hi',
    ]) {
      await rejectsWith(assertSafeUrl(url, { lookup }), 'BLOCKED_URL', /http/);
    }
    await rejectsWith(assertSafeUrl('http://user:pw@public.test/', { lookup }), 'BLOCKED_URL', /credentials/);
    await rejectsWith(
      assertSafeUrl('http://public.test:6379/', { lookup, allowedPorts: [80, 443] }),
      'BLOCKED_URL',
    );
    await assertSafeUrl('https://public.test/', { lookup, allowedPorts: [80, 443] });
  });

  it('reports invalid URLs and DNS failures', async () => {
    await rejectsWith(assertSafeUrl('not a url', { lookup }), 'INVALID_URL');
    await rejectsWith(assertSafeUrl('http://nxdomain.test/', { lookup }), 'DNS_ERROR');
    await rejectsWith(assertSafeUrl('http://empty.test/', { lookup }), 'DNS_ERROR');
  });

  it('can allow specific addresses or turn the checks off', async () => {
    await assertSafeUrl('http://internal.test/', { lookup, allowAddress: (a) => a === '10.0.0.5' });
    await assertSafeUrl('http://127.0.0.1/', { allowPrivateNetworks: true });
  });
});

describe('unfurl SSRF guard', () => {
  it('never calls fetch for a blocked URL', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response('');
    }) as typeof globalThis.fetch;
    await rejectsWith(unfurl('http://169.254.169.254/latest/meta-data/', { fetch }), 'BLOCKED_URL');
    await rejectsWith(
      unfurl('http://internal.test/', { fetch, lookup: fakeDns({ 'internal.test': ['10.0.0.1'] }) }),
      'BLOCKED_URL',
    );
    assert.equal(calls, 0);
  });

  it('re-checks every redirect target before following it', async () => {
    const seen: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url === 'https://public.test/start') {
        return new Response(null, { status: 302, headers: { location: 'http://internal.test/admin' } });
      }
      return new Response('<title>should not be reached</title>', {
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof globalThis.fetch;
    const lookup = fakeDns({ 'public.test': ['93.184.216.34'], 'internal.test': ['10.0.0.1'] });
    await rejectsWith(unfurl('https://public.test/start', { fetch, lookup }), 'BLOCKED_URL', /10\.0\.0\.1/);
    assert.deepEqual(seen, ['https://public.test/start']);
  });

  it('blocks redirects to other protocols', async () => {
    const fetch = (async () =>
      new Response(null, {
        status: 301,
        headers: { location: 'file:///etc/passwd' },
      })) as typeof globalThis.fetch;
    const lookup = fakeDns({ 'public.test': ['93.184.216.34'] });
    await rejectsWith(unfurl('https://public.test/', { fetch, lookup }), 'BLOCKED_URL');
  });

  it('passes the fetched page through the parser', async () => {
    const fetch = (async () =>
      new Response('<html lang="en"><title>Hi</title>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as typeof globalThis.fetch;
    const r = await unfurl('https://public.test/x#frag', {
      fetch,
      lookup: fakeDns({ 'public.test': ['1.1.1.1'] }),
    });
    assert.equal(r.title, 'Hi');
    assert.equal(r.url, 'https://public.test/x');
    assert.equal(r.response?.status, 200);
  });
});
