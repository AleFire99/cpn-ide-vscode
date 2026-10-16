import { describe, expect, it } from 'vitest';
import { adoptiumPlatform, buildAdoptiumUrl, javaCandidates, parseJavaMajor, safeDirName } from '../../src/runtime/jre-core';

describe('parseJavaMajor', () => {
  it('parses modern versions', () => {
    expect(parseJavaMajor('openjdk version "17.0.20" 2026-07-21\nOpenJDK Runtime Environment')).toBe(17);
    expect(parseJavaMajor('openjdk version "21" 2023-09-19')).toBe(21);
    expect(parseJavaMajor('java version "11.0.2" 2019-01-15 LTS')).toBe(11);
    expect(parseJavaMajor('openjdk version "22-ea" 2024-03-19')).toBe(22);
  });
  it('parses legacy 1.x versions', () => {
    expect(parseJavaMajor('java version "1.8.0_292"')).toBe(8);
  });
  it('returns undefined for garbage', () => {
    expect(parseJavaMajor('command not found')).toBeUndefined();
    expect(parseJavaMajor('')).toBeUndefined();
  });
});

describe('adoptiumPlatform', () => {
  it('maps supported platforms', () => {
    expect(adoptiumPlatform('linux', 'x64')).toEqual({ os: 'linux', architecture: 'x64' });
    expect(adoptiumPlatform('win32', 'x64')).toEqual({ os: 'windows', architecture: 'x64' });
    expect(adoptiumPlatform('darwin', 'arm64')).toEqual({ os: 'mac', architecture: 'aarch64' });
  });
  it('rejects unsupported ones', () => {
    expect(adoptiumPlatform('freebsd', 'x64')).toBeUndefined();
    expect(adoptiumPlatform('linux', 'ia32')).toBeUndefined();
  });
});

describe('buildAdoptiumUrl', () => {
  it('builds the API URL', () => {
    const u = new URL(buildAdoptiumUrl('linux', 'x64'));
    expect(u.origin + u.pathname).toBe('https://api.adoptium.net/v3/assets/latest/17/hotspot');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      architecture: 'x64',
      image_type: 'jre',
      os: 'linux',
      vendor: 'eclipse',
    });
  });
});

describe('javaCandidates', () => {
  it('orders setting, JAVA_HOME, PATH', () => {
    expect(javaCandidates('/opt/j/bin/java', { JAVA_HOME: '/jh' }, 'linux')).toEqual([
      '/opt/j/bin/java',
      '/jh/bin/java',
      'java',
    ]);
    expect(javaCandidates('  ', {}, 'linux')).toEqual(['java']);
  });
  it('safeDirName strips unsafe characters', () => {
    expect(safeDirName('jdk-17.0.20.1+1')).toBe('jdk-17.0.20.1_1');
  });
});
