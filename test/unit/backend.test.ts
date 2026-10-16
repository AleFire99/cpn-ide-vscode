import * as http from 'node:http';
import * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import { pickFreePort, preflightError, probeHttp, waitForHttp } from '../../src/runtime/backend-core';

describe('pickFreePort', () => {
  it('returns a bindable port', async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer().listen(port, '127.0.0.1', () => s.close(() => resolve())).on('error', reject);
    });
  });
});

describe('preflightError', () => {
  it('blocks macOS and mentions backendUrl', () => {
    expect(preflightError('darwin', true)).toMatch(/cpnIde\.backendUrl/);
  });
  it('requires 32-bit loader on linux', () => {
    expect(preflightError('linux', false)).toMatch(/libc6:i386/);
    expect(preflightError('linux', true)).toBeUndefined();
  });
  it('allows windows', () => {
    expect(preflightError('win32', false)).toBeUndefined();
  });
});

describe('waitForHttp', () => {
  it('resolves on any HTTP status (404)', async () => {
    const srv = http.createServer((_q, r) => r.writeHead(404).end());
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await probeHttp(`http://127.0.0.1:${port}/`)).toBe(true);
    await waitForHttp(`http://127.0.0.1:${port}/`, 5000);
    srv.close();
  });
  it('fails fast when the process is dead', async () => {
    const port = await pickFreePort();
    await expect(waitForHttp(`http://127.0.0.1:${port}/`, 5000, () => false)).rejects.toThrow(/exited/);
  });
  it('times out', async () => {
    const port = await pickFreePort();
    await expect(waitForHttp(`http://127.0.0.1:${port}/`, 600, () => true, 100)).rejects.toThrow(/did not respond/);
  });
});
