import { describe, expect, it } from 'vitest';
import {
  CONTAINER_NAME,
  DOCKER_IMAGE,
  decideAction,
  dockerProblem,
  ensureContainer,
  parseContainerState,
  parseDockerPort,
  runArgs,
  type DockerExec,
  type ExecResult,
} from '../../src/runtime/docker-core';

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = 'boom'): ExecResult => ({ code: 1, stdout: '', stderr });

/** Fake docker: answers by subcommand and records every call. */
function fakeDocker(answers: Record<string, ExecResult | ExecResult[]>) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    const a = answers[args[0]!] ?? ok();
    return Array.isArray(a) ? (a.shift() ?? ok()) : a;
  };
  return { exec, calls, subcommands: () => calls.map((c) => c[0]) };
}

describe('runArgs', () => {
  it('binds the host port on loopback only', () => {
    expect(runArgs(49153)).toEqual(['run', '--detach', '--name', CONTAINER_NAME, '-p', '127.0.0.1:49153:8080', DOCKER_IMAGE]);
  });
});

describe('parseDockerPort', () => {
  it('reads the host port of the first mapping', () => {
    expect(parseDockerPort('127.0.0.1:49153\n')).toBe(49153);
    expect(parseDockerPort('0.0.0.0:32768\n[::]:32768\n')).toBe(32768);
    expect(parseDockerPort('8080/tcp -> 127.0.0.1:50000')).toBe(50000);
  });
  it('returns undefined without a mapping', () => {
    expect(parseDockerPort('')).toBeUndefined();
    expect(parseDockerPort('Error: no public port')).toBeUndefined();
  });
});

describe('container state', () => {
  it('maps inspect results to actions', () => {
    expect(parseContainerState(fail('No such object'))).toBe('missing');
    expect(parseContainerState(ok('running\n'))).toBe('running');
    expect(parseContainerState(ok('exited\n'))).toBe('stopped');
    expect(parseContainerState(ok('created\n'))).toBe('stopped');
    expect(decideAction('missing')).toBe('create');
    expect(decideAction('stopped')).toBe('start');
    expect(decideAction('running')).toBe('reuse');
  });
});

describe('dockerProblem', () => {
  it('tells a missing docker from a stopped daemon', () => {
    expect(dockerProblem({ code: null, stdout: '', stderr: '', notFound: true })).toMatch(/not installed/);
    expect(dockerProblem(fail('Cannot connect to the Docker daemon\n'))).toMatch(/daemon is not running.*Cannot connect/);
    expect(dockerProblem(ok('27.0.1'))).toBeUndefined();
  });
});

describe('ensureContainer', () => {
  const pick = async () => 40000;

  it('creates the container when missing', async () => {
    const d = fakeDocker({ inspect: fail(), port: ok('127.0.0.1:40000\n') });
    expect(await ensureContainer(d.exec, pick)).toBe('http://127.0.0.1:40000');
    expect(d.subcommands()).toEqual(['version', 'inspect', 'run', 'port']);
    expect(d.calls[2]).toEqual(runArgs(40000));
  });

  it('starts a stopped container and reads its port', async () => {
    const d = fakeDocker({ inspect: ok('exited'), port: ok('0.0.0.0:41000\n') });
    expect(await ensureContainer(d.exec, pick)).toBe('http://127.0.0.1:41000');
    expect(d.subcommands()).toEqual(['version', 'inspect', 'start', 'port']);
  });

  it('reuses a running container', async () => {
    const d = fakeDocker({ inspect: ok('running'), port: ok('127.0.0.1:42000') });
    expect(await ensureContainer(d.exec, pick)).toBe('http://127.0.0.1:42000');
    expect(d.subcommands()).toEqual(['version', 'inspect', 'port']);
  });

  it('recreates a stopped container that cannot start', async () => {
    const d = fakeDocker({ inspect: ok('exited'), start: fail('port is already allocated'), port: ok('127.0.0.1:40000') });
    expect(await ensureContainer(d.exec, pick)).toBe('http://127.0.0.1:40000');
    expect(d.subcommands()).toEqual(['version', 'inspect', 'start', 'rm', 'run', 'port']);
  });

  it('stops at the docker check when docker is unusable', async () => {
    const d = fakeDocker({ version: { code: null, stdout: '', stderr: '', notFound: true } });
    await expect(ensureContainer(d.exec, pick)).rejects.toThrow(/not installed/);
    expect(d.subcommands()).toEqual(['version']);
  });

  it('reports a failed run', async () => {
    const d = fakeDocker({ inspect: fail(), run: fail('pull access denied') });
    await expect(ensureContainer(d.exec, pick)).rejects.toThrow(/docker run failed: pull access denied/);
  });

  it('fails when no port mapping is found', async () => {
    const d = fakeDocker({ inspect: ok('running'), port: ok('') });
    await expect(ensureContainer(d.exec, pick)).rejects.toThrow(/docker port failed/);
  });
});
