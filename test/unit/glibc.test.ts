import { describe, expect, it } from 'vitest';
import { checkGlibc32, glibc32Install, glibc32Message, parseOsRelease } from '../../src/runtime/glibc-core';

const APT = 'sudo dpkg --add-architecture i386 && sudo apt update && sudo apt install libc6:i386';

describe('parseOsRelease', () => {
  it('reads quoted and bare values', () => {
    expect(parseOsRelease('ID=fedora\nID_LIKE="rhel centos"\n# c\n')).toEqual({ ID: 'fedora', ID_LIKE: 'rhel centos' });
  });
});

describe('glibc32Install', () => {
  it.each([
    ['ubuntu', 'ID=ubuntu\nID_LIKE=debian', 'debian', APT],
    ['debian', 'ID=debian', 'debian', APT],
    ['fedora', 'ID=fedora', 'fedora', 'sudo dnf install glibc.i686'],
    ['rhel', 'ID="rhel"\nID_LIKE="fedora"', 'fedora', 'sudo dnf install glibc.i686'],
    ['opensuse', 'ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"', 'opensuse', 'sudo zypper install glibc-32bit'],
    ['arch', 'ID=arch', 'arch', 'sudo pacman -S lib32-glibc'],
  ])('%s', (_n, text, family, command) => {
    expect(glibc32Install(text)).toMatchObject({ family, command });
  });

  it('notes multilib on Arch', () => {
    expect(glibc32Install('ID=arch').note).toMatch(/multilib/);
  });

  it('falls back to ID_LIKE for derivatives', () => {
    expect(glibc32Install('ID=linuxmint\nID_LIKE="ubuntu debian"').family).toBe('debian');
    expect(glibc32Install('ID=manjaro\nID_LIKE=arch').family).toBe('arch');
    expect(glibc32Install('ID=nobara\nID_LIKE="rhel centos fedora"').family).toBe('fedora');
    expect(glibc32Install('ID=sle\nID_LIKE="suse opensuse"').family).toBe('opensuse');
  });

  it('uses rpm-ostree on Fedora Atomic', () => {
    for (const text of ['ID=fedora\nVARIANT_ID=silverblue', 'ID=fedora\nVARIANT_ID=kinoite']) {
      expect(glibc32Install(text)).toMatchObject({ family: 'atomic', command: 'rpm-ostree install glibc.i686' });
    }
    expect(glibc32Install('ID=fedora', true)).toMatchObject({ family: 'atomic' });
    expect(glibc32Install('ID=fedora', true).note).toMatch(/Reboot/);
  });

  it('has no command for unknown or unreadable distros', () => {
    expect(glibc32Install('ID=void')).toEqual({ family: 'unknown' });
    expect(glibc32Install('')).toEqual({ family: 'unknown' });
    expect(glibc32Message({ family: 'unknown' })).toMatch(/Docker backend/);
  });
});

describe('checkGlibc32', () => {
  it('passes when the loader exists', () => {
    expect(checkGlibc32({ exists: (p) => p === '/lib/ld-linux.so.2', readOsRelease: () => 'ID=fedora' })).toBeUndefined();
  });

  it('reports the command when it is missing', () => {
    const p = checkGlibc32({ exists: () => false, readOsRelease: () => 'ID=fedora' });
    expect(p?.command).toBe('sudo dnf install glibc.i686');
    expect(glibc32Message(p!)).toContain('sudo dnf install glibc.i686');
  });

  it('detects ostree and tolerates a missing os-release', () => {
    expect(checkGlibc32({ exists: (p) => p === '/run/ostree-booted', readOsRelease: () => 'ID=fedora' })?.family).toBe('atomic');
    expect(checkGlibc32({ exists: () => false, readOsRelease: () => undefined })?.family).toBe('unknown');
  });
});
