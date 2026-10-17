// vscode-free logic of the Docker backend: argv building, `docker port` parsing and start/reuse decisions.
// Every docker call goes through an injected exec, so tests never run docker.

export const DOCKER_IMAGE = 'ghcr.io/alefire99/cpn-ide-backend:latest';
export const CONTAINER_NAME = 'cpn-ide-backend';
/** Port the backend listens on inside the image (SERVER_PORT in docker/Dockerfile). */
export const CONTAINER_PORT = 8080;

export interface ExecResult {
  /** Exit code; null if the process could not be started or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The `docker` executable does not exist. */
  notFound?: boolean;
}

/** Runs `docker <args>`; resolves (never rejects) with the outcome. */
export type DockerExec = (args: string[]) => Promise<ExecResult>;

export type ContainerState = 'missing' | 'running' | 'stopped';

export const versionArgs = (): string[] => ['version', '--format', '{{.Server.Version}}'];
export const inspectArgs = (): string[] => ['inspect', '--format', '{{.State.Status}}', CONTAINER_NAME];
export const portArgs = (): string[] => ['port', CONTAINER_NAME, `${CONTAINER_PORT}/tcp`];
export const startArgs = (): string[] => ['start', CONTAINER_NAME];
export const stopArgs = (): string[] => ['stop', '--time', '5', CONTAINER_NAME];
export const removeArgs = (): string[] => ['rm', '--force', CONTAINER_NAME];

export function runArgs(hostPort: number): string[] {
  return ['run', '--detach', '--name', CONTAINER_NAME, '-p', `127.0.0.1:${hostPort}:${CONTAINER_PORT}`, DOCKER_IMAGE];
}

/** Host port from `docker port` output, e.g. "127.0.0.1:49153" or "0.0.0.0:49153" (several lines when IPv6 too). */
export function parseDockerPort(stdout: string): number | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const m = /:(\d+)\s*$/.exec(line.trim());
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** Container state from the `docker inspect` result; a failed inspect means the container does not exist. */
export function parseContainerState(r: ExecResult): ContainerState {
  if (r.code !== 0) return 'missing';
  const s = r.stdout.trim();
  return s === 'running' || s === 'restarting' ? 'running' : 'stopped';
}

export type ContainerAction = 'create' | 'start' | 'reuse';

export const decideAction = (state: ContainerState): ContainerAction =>
  state === 'missing' ? 'create' : state === 'stopped' ? 'start' : 'reuse';

/** Clear message for a failed `docker version`, or undefined when the daemon answers. */
export function dockerProblem(r: ExecResult): string | undefined {
  if (r.notFound) return 'Docker is not installed (the "docker" command was not found). Install Docker Desktop or Docker Engine, then try again.';
  if (r.code !== 0) {
    const detail = r.stderr.trim().split(/\r?\n/).pop();
    return `Docker is installed but its daemon is not running. Start Docker and try again.${detail ? ` (${detail})` : ''}`;
  }
  return undefined;
}

const failure = (what: string, r: ExecResult) => new Error(`${what} failed: ${r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`}`);

/**
 * Make sure the named container is running and return its base URL (http://127.0.0.1:<port>).
 * Reuses an existing container (starting it if stopped); if a stopped one cannot start
 * (its old host port is taken), it is removed and recreated on a fresh port.
 */
export async function ensureContainer(exec: DockerExec, pickPort: () => Promise<number>): Promise<string> {
  const problem = dockerProblem(await exec(versionArgs()));
  if (problem) throw new Error(problem);

  let action = decideAction(parseContainerState(await exec(inspectArgs())));
  if (action === 'start') {
    const r = await exec(startArgs());
    if (r.code !== 0) {
      await exec(removeArgs());
      action = 'create';
    }
  }
  if (action === 'create') {
    const r = await exec(runArgs(await pickPort()));
    if (r.code !== 0) throw failure('docker run', r);
  }
  const r = await exec(portArgs());
  const port = r.code === 0 ? parseDockerPort(r.stdout) : undefined;
  if (!port) throw failure('docker port', r);
  return `http://127.0.0.1:${port}`;
}
