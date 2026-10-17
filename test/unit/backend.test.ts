import * as http from 'node:http';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';
import {
  buildBackendArgs,
  findSimulatorPids,
  isPortListening,
  pickFreePort,
  preflightError,
  probeHttp,
  reapStaleSimulators,
  waitForHttp,
} from '../../src/runtime/backend-core';

describe('pickFreePort', () => {
  it('returns a bindable port', async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer().listen(port, '127.0.0.1', () => s.close(() => resolve())).on('error', reject);
    });
  });
});

describe('buildBackendArgs', () => {
  it('binds to loopback only', () => {
    const args = buildBackendArgs({ userHome: '/h', tmpDir: '/t', port: 1234, backendDir: '/b' });
    expect(args).toContain('-Dserver.address=127.0.0.1');
    expect(args).toContain('-Djava.io.tmpdir=/t');
    expect(args).toContain('-Dserver.port=1234');
  });
});

describe('preflightError', () => {
  it('blocks macOS and mentions backendUrl', () => {
    expect(preflightError('darwin')).toMatch(/cpnIde\.backendUrl/);
  });
  it('allows linux (32-bit glibc is checked separately)', () => {
    expect(preflightError('linux')).toBeUndefined();
  });
  it('allows windows', () => {
    expect(preflightError('win32')).toBeUndefined();
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

describe('isPortListening', () => {
  it('detects a listener on loopback', async () => {
    const srv = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await isPortListening(port)).toBe(true);
    srv.close();
    expect(await isPortListening(port)).toBe(false);
  });
});

describe('simulator process discovery', () => {
  afterEach(removeTempDirs);

  // Fake /proc: <pid>/cwd symlinks.
  function fakeProc(cwds: Record<string, string>): string {
    const root = tempDir('fakeproc-');
    for (const [pid, cwd] of Object.entries(cwds)) {
      fs.mkdirSync(path.join(root, pid));
      fs.symlinkSync(cwd, path.join(root, pid, 'cwd'));
    }
    fs.mkdirSync(path.join(root, 'not-a-pid'));
    return root;
  }

  it('finds only processes running under <tmp>/accesscpn', () => {
    const proc = fakeProc({
      '10': '/x/tmp/accesscpn/simulator',
      '11': '/x/tmp/accesscpn',
      '12': '/x/tmp/accesscpn-other',
      '13': '/elsewhere',
    });
    expect(findSimulatorPids('/x/tmp', proc).sort()).toEqual([10, 11]);
  });

  it('also finds forks that left the directory but still run a binary from it', () => {
    const proc = fakeProc({ '20': '/elsewhere', '21': '/elsewhere' });
    fs.symlinkSync('/x/tmp/accesscpn/simulator/cpnmld.x86-linux', path.join(proc, '20', 'exe'));
    fs.symlinkSync('/usr/bin/java', path.join(proc, '21', 'exe'));
    expect(findSimulatorPids('/x/tmp', proc)).toEqual([20]);
  });

  it('only cleans directories of dead owners', () => {
    const root = tempDir('tmproot-');
    fs.mkdirSync(path.join(root, '111'));
    fs.mkdirSync(path.join(root, '222'));
    fs.mkdirSync(path.join(root, 'keep-me'));
    reapStaleSimulators(root, (pid) => pid === 222);
    expect(fs.readdirSync(root).sort()).toEqual(['222', 'keep-me']);
  });
});
