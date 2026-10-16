import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';
import { descendantPids, findPortOwner, isForeignSimulator, onlyTimeWait, parseProcNetTcp } from '../../src/runtime/backend-core';

const HEAD = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
// 20001 = 0x4E21
const row = (sl: number, local: string, st: string, uid: number, inode: number) =>
  `   ${sl}: ${local} 00000000:0000 ${st} 00000000:00000000 00:00000000 00000000  ${uid}        0 ${inode} 1 0000000000000000 100 0 0 10 0\n`;

afterEach(removeTempDirs);

function fakeProc(tcp: string, tcp6 = HEAD, procs: { pid: number; inode: number; cmd: string; cwd: string; uid: number }[] = []): string {
  const root = tempDir('fakeproc-');
  fs.mkdirSync(path.join(root, 'net'));
  fs.writeFileSync(path.join(root, 'net/tcp'), tcp);
  fs.writeFileSync(path.join(root, 'net/tcp6'), tcp6);
  for (const p of procs) {
    const d = path.join(root, String(p.pid));
    fs.mkdirSync(path.join(d, 'fd'), { recursive: true });
    fs.symlinkSync(`socket:[${p.inode}]`, path.join(d, 'fd/7'));
    fs.symlinkSync('/dev/null', path.join(d, 'fd/0'));
    fs.symlinkSync(p.cwd, path.join(d, 'cwd'));
    fs.writeFileSync(path.join(d, 'cmdline'), p.cmd.split(' ').join('\0') + '\0');
    fs.writeFileSync(path.join(d, 'status'), `Name:\tx\nUid:\t${p.uid}\t${p.uid}\t${p.uid}\t${p.uid}\n`);
  }
  return root;
}

describe('parseProcNetTcp', () => {
  it('matches rows by local port only', () => {
    const t = HEAD + row(0, '0100007F:4E21', '0A', 1000, 111) + row(1, '0100007F:1F90', '0A', 1000, 222);
    expect(parseProcNetTcp(t, 20001)).toEqual([{ state: '0A', inode: '111' }]);
  });
});

describe('findPortOwner', () => {
  const procs = [
    { pid: 4242, inode: 111, cmd: '/tmp/accesscpn/simulator/cpnmld.x86-linux 20001 ./run.x86-linux', cwd: '/tmp/accesscpn/simulator', uid: 1000 },
  ];

  it('maps the listening inode to a process', () => {
    const root = fakeProc(HEAD + row(0, '00000000:4E21', '0A', 1000, 111), HEAD, procs);
    expect(findPortOwner(20001, root)).toEqual({
      pid: 4242,
      cmdline: '/tmp/accesscpn/simulator/cpnmld.x86-linux 20001 ./run.x86-linux',
      cwd: '/tmp/accesscpn/simulator',
      uid: 1000,
    });
  });

  it('reads tcp6 too', () => {
    const root = fakeProc(HEAD, HEAD + row(0, '00000000000000000000000000000000:4E21', '0A', 1000, 111), procs);
    expect(findPortOwner(20001, root)?.pid).toBe(4242);
  });

  it('ignores non-LISTEN sockets and unknown inodes', () => {
    expect(findPortOwner(20001, fakeProc(HEAD + row(0, '0100007F:4E21', '06', 0, 0), HEAD, procs))).toBeUndefined();
    expect(findPortOwner(20001, fakeProc(HEAD + row(0, '0100007F:4E21', '0A', 1000, 999), HEAD, procs))).toBeUndefined();
  });
});

describe('onlyTimeWait', () => {
  it('is true only when every socket on the port is TIME-WAIT', () => {
    expect(onlyTimeWait(20001, fakeProc(HEAD + row(0, '0100007F:4E21', '06', 0, 0)))).toBe(true);
    expect(onlyTimeWait(20001, fakeProc(HEAD + row(0, '0100007F:4E21', '06', 0, 0) + row(1, '0100007F:4E21', '0A', 1000, 5)))).toBe(false);
    expect(onlyTimeWait(20001, fakeProc(HEAD))).toBe(false);
  });
});

describe('isForeignSimulator', () => {
  const owner = { pid: 1, cmdline: '/tmp/accesscpn/simulator/cpnmld.x86-linux 20001 ./run.x86-linux', cwd: '/tmp/accesscpn/simulator', uid: 1000 };
  it('detects a same-user cpnmld outside our tmp root', () => {
    expect(isForeignSimulator(owner, '/gs/tmp', 1000)).toBe(true);
  });
  it('rejects our own, other users and other programs', () => {
    expect(isForeignSimulator({ ...owner, cwd: '/gs/tmp/55/accesscpn/simulator' }, '/gs/tmp', 1000)).toBe(false);
    expect(isForeignSimulator(owner, '/gs/tmp', 1001)).toBe(false);
    expect(isForeignSimulator({ ...owner, cmdline: 'nginx' }, '/gs/tmp', 1000)).toBe(false);
  });
});

describe('descendantPids', () => {
  it('walks ppid links', () => {
    const root = tempDir('fakeproc-');
    for (const [pid, ppid] of [[10, 1], [11, 10], [12, 11], [13, 1]]) {
      fs.mkdirSync(path.join(root, String(pid)));
      fs.writeFileSync(path.join(root, String(pid), 'stat'), `${pid} (a b) S ${ppid} 0 0`);
    }
    expect(descendantPids(10, root).sort()).toEqual([11, 12]);
  });
});
