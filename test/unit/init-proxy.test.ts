import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InitProxy, LOCK_HEADER } from '../../src/runtime/init-proxy';

const INIT = '/api/v2/cpn/init';
const SIM_INIT = '/api/v2/cpn/sim/init';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait for a condition instead of a fixed delay, so a slow runner cannot reorder the events. */
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) if (Date.now() > end) throw new Error('timed out waiting');
}

describe('InitProxy', () => {
  let upstream: http.Server;
  let proxy: InitProxy;
  let url: string;
  /** Upstream behaviour per request; events record start/end of every init. */
  let events: string[];
  let initHandler: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void;
  let inits: number;
  let seenLockHeader = false;

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
      if (req.method === 'POST' && req.url === SIM_INIT) {
        events.push('simInit');
        seenLockHeader = req.headers[LOCK_HEADER] !== undefined;
        return void res.end('{}');
      }
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
    // The upstream holds each init until the test releases it.
    const pending: (() => void)[] = [];
    initHandler = (_req, res, n) => {
      events.push(`start${n}`);
      pending.push(() => {
        events.push(`end${n}`);
        res.end('{"success":true}');
      });
    };
    const init = (s: string) => fetch(`${url}${INIT}`, { method: 'POST', headers: { 'X-SessionId': s }, body: '{}' });
    const a = init('a');
    const b = init('b');
    await until(() => events.length > 0);
    const other = await fetch(`${url}/api/v2/cpn/other`);
    expect(other.status).toBe(201);
    await sleep(50);
    expect(events).toEqual(['start1']);
    pending.shift()?.();
    expect((await a).status).toBe(200);
    await until(() => pending.length > 0);
    pending.shift()?.();
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
    await until(() => events.length > 0);
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

  it('makes sim/init wait for an in-flight init', async () => {
    const a = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    await sleep(30);
    const b = fetch(`${url}${SIM_INIT}`, { method: 'POST', body: '{}' });
    await sleep(30);
    expect(events).toEqual(['start1']);
    expect((await b).status).toBe(200);
    expect((await a).status).toBe(200);
    expect(events).toEqual(['start1', 'end1', 'simInit']);
  });

  it('names the route in the 504 when sim/init hangs', async () => {
    proxy.stop();
    await startProxy(150);
    upstream.removeAllListeners('request');
    upstream.on('request', () => {}); // never answers
    const res = await fetch(`${url}${SIM_INIT}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(504);
    expect(await res.text()).toContain(SIM_INIT);
  });

  it('keeps passing other routes through while an init is in flight', async () => {
    const a = fetch(`${url}${INIT}`, { method: 'POST', body: '{}' });
    await sleep(30);
    expect((await fetch(`${url}/api/v2/cpn/sim/step`, { method: 'POST', body: '{}' })).status).toBe(201);
    expect((await fetch(`${url}${SIM_INIT}`, { method: 'GET' })).status).toBe(201);
    await a;
  });

  it('keeps a held lock for its session until release, without leaking the header', async () => {
    const as = (session: string, lock?: string) => ({
      method: 'POST',
      headers: { 'X-SessionId': session, ...(lock && { [LOCK_HEADER]: lock }) },
      body: '{}',
    });
    await fetch(`${url}${INIT}`, as('h', 'hold'));
    const other = fetch(`${url}${INIT}`, as('ui'));
    await sleep(60);
    expect((await fetch(`${url}${SIM_INIT}`, as('h', 'hold'))).status).toBe(200);
    expect(seenLockHeader).toBe(false);
    expect((await fetch(`${url}/api/v2/cpn/sim/step`, as('h', 'hold'))).status).toBe(201);
    // Another session cannot release it.
    await fetch(`${url}/api/v2/cpn/`, { headers: { 'X-SessionId': 'ui', [LOCK_HEADER]: 'release' } });
    await sleep(60);
    expect(events).toEqual(['start1', 'end1', 'simInit']);
    await fetch(`${url}/api/v2/cpn/`, { headers: { 'X-SessionId': 'h', [LOCK_HEADER]: 'release' } });
    expect((await other).status).toBe(200);
    expect(events).toEqual(['start1', 'end1', 'simInit', 'start2', 'end2']);
  });

  it('lets go of a held lock after the hold timeout', async () => {
    proxy.stop();
    proxy = new InitProxy(1000, 100);
    url = await proxy.start(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
    await fetch(`${url}${INIT}`, { method: 'POST', headers: { 'X-SessionId': 'h', [LOCK_HEADER]: 'hold' }, body: '{}' });
    expect((await fetch(`${url}${INIT}`, { method: 'POST', body: '{}' })).status).toBe(200);
  });
});
