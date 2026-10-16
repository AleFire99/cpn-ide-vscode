import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InitProxy } from '../../src/runtime/init-proxy';

const INIT = '/api/v2/cpn/init';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('InitProxy', () => {
  let upstream: http.Server;
  let proxy: InitProxy;
  let url: string;
  /** Upstream behaviour per request; events record start/end of every init. */
  let events: string[];
  let initHandler: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void;
  let inits: number;

  const startProxy = async (timeoutMs?: number) => {
    proxy = new InitProxy(timeoutMs);
    url = await proxy.start(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  };

  beforeEach(async () => {
    events = [];
    inits = 0;
    initHandler = (_req, res, n) => {
      events.push(`start${n}`);
      setTimeout(() => {
        events.push(`end${n}`);
        res.end('{"success":true}');
      }, 100);
    };
    upstream = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === INIT) return initHandler(req, res, ++inits);
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(201, { 'X-Echo': String(req.headers['x-sessionid']), 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() }));
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    await startProxy();
  });

  afterEach(() => {
    proxy.stop();
    upstream.closeAllConnections();
    upstream.close();
  });

  it('passes method, path, headers, body, status and response headers through', async () => {
    const res = await fetch(`${url}/api/v2/cpn/sim/init?x=1`, {
      method: 'PUT',
      headers: { 'X-SessionId': 'abc' },
      body: 'hello',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-echo')).toBe('abc');
    expect(await res.json()).toEqual({ method: 'PUT', url: '/api/v2/cpn/sim/init?x=1', body: 'hello' });
  });

  it('passes CORS preflight OPTIONS through', async () => {
    const res = await fetch(`${url}${INIT}`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', Origin: 'http://x' } });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await res.json()) as { method: string }).method).toBe('OPTIONS');
  });

  it('serializes concurrent inits but not other routes', async () => {
    const init = (s: string) => fetch(`${url}${INIT}`, { method: 'POST', headers: { 'X-SessionId': s }, body: '{}' });
    const a = init('a');
    const b = init('b');
    await sleep(30);
    const other = await fetch(`${url}/api/v2/cpn/other`);
    expect(other.status).toBe(201);
    expect(events).toEqual(['start1']);
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2']);
  });

  it('releases the queue when a client aborts', async () => {
    initHandler = (_req, res, n) => {
      events.push(`start${n}`);
      if (n > 1) res.end('{}');
    };
    const ac = new AbortController();
    const a = fetch(`${url}${INIT}`, { method: 'POST', body: '{}', signal: ac.signal }).catch(() => undefined);
    await sleep(50);
    const b = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    await sleep(50);
    expect(events).toEqual(['start1']);
    ac.abort();
    await a;
    expect((await b).status).toBe(200);
    expect(events).toEqual(['start1', 'start2']);
  });

  it('releases the queue when the upstream errors', async () => {
    initHandler = (req, res, n) => {
      if (n === 1) return void req.socket.destroy();
      res.end('{}');
    };
    const a = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    const b = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    expect((await a).status).toBe(502);
    expect((await b).status).toBe(200);
  });

  it('answers 504 when an init hangs and then serves the next one', async () => {
    proxy.stop();
    await startProxy(200);
    initHandler = (_req, res, n) => {
      if (n > 1) res.end('{}');
    };
    const a = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    const b = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    const ra = await a;
    expect(ra.status).toBe(504);
    expect(await ra.text()).toContain('did not answer');
    expect((await b).status).toBe(200);
  });
});
