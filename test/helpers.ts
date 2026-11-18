import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after } from 'node:test';
import type { LookupFunction, UnfurlOptions } from '../src/index.js';

/** Reads an HTML fixture. Tests run from dist/test, so the path goes back to the sources. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestServer {
  origin: string;
  /** Number of requests per path. */
  hits: Map<string, number>;
}

/** Starts a local HTTP server on 127.0.0.1 with one handler per path. Closed after the file's tests. */
export async function serve(routes: Record<string, Handler>): Promise<TestServer> {
  const hits = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const handler = routes[path];
    if (handler) handler(req, res);
    else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, hits };
}

/** Options that let tests reach the local server and nothing else that is private. */
export const LOCAL: UnfurlOptions = {
  allowAddress: (address) => address === '127.0.0.1',
  timeout: 3000,
};

/** A fake DNS resolver: hostname -> addresses. Unknown names fail like NXDOMAIN. */
export function fakeDns(table: Record<string, string[]>): LookupFunction {
  return async (hostname) => {
    const list = table[hostname];
    if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

export function html(body: string, headers: Record<string, string> = {}): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  };
}
