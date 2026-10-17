import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const INIT_ROUTE = '/api/v2/cpn/init';
const SIM_INIT_ROUTE = '/api/v2/cpn/sim/init';
const SERIALIZED = new Set([INIT_ROUTE, SIM_INIT_ROUTE]);

/**
 * Proxy-only request header (never forwarded). `hold` runs the request under a lock owned by its session (X-SessionId)
 * and keeps the lock afterwards, so a caller can run init → sim/init → steps without another session's init in
 * between; `release` runs the request under that lock and then frees it (any route, so a cheap GET can let go).
 */
export const LOCK_HEADER = 'x-cpn-lock';

/**
 * Local reverse proxy in front of the backend. Two concurrent first `POST /api/v2/cpn/init` calls hang one of them
 * forever inside Access/CPN (Simulator.send), and a `POST /api/v2/cpn/sim/init` that arrives while another session's
 * CreateNewNet is still running fails with "Could not parse declaration" (single simulator daemon). Both routes go
 * through one FIFO mutex; everything else passes through. A held lock expires `holdTimeoutMs` after its last request.
 */
export class InitProxy {
  private server: http.Server | undefined;
  private target = new URL('http://127.0.0.1');
  private tail: Promise<void> = Promise.resolve();

  private held: { session: string; release: () => void; timer?: NodeJS.Timeout } | undefined;

  constructor(
    private readonly initTimeoutMs = 120000,
    private readonly holdTimeoutMs = 15000,
  ) {}

  /** Start listening on a free loopback port (once) and forward to `target`. Returns the proxy base URL. */
  async start(target: string): Promise<string> {
    this.target = new URL(target);
    if (!this.server) {
      const server = http.createServer((req, res) => void this.handle(req, res));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      this.server = server;
    }
    return this.url!;
  }

  /** Proxy base URL while listening. */
  get url(): string | undefined {
    return this.server ? `http://127.0.0.1:${(this.server.address() as AddressInfo).port}` : undefined;
  }

  stop(): void {
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = undefined;
  }

  /** Wait for our turn; the returned function releases the lock. */
  private acquire(): Promise<() => void> {
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    const turn = this.tail.then(() => release);
    this.tail = this.tail.then(() => done);
    return turn;
  }

  private drop(h: NonNullable<InitProxy['held']>): void {
    if (this.held !== h) return;
    clearTimeout(h.timer);
    this.held = undefined;
    h.release();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const route = (req.url ?? '').split('?')[0];
    const lock = req.headers[LOCK_HEADER];
    const session = String(req.headers['x-sessionid'] ?? '');
    const owner = (): boolean => !!lock && this.held?.session === session;
    const serialize = (req.method === 'POST' && SERIALIZED.has(route)) || lock === 'hold';
    const headers = { ...req.headers };
    delete headers[LOCK_HEADER];
    let release = (): void => {};
    let closed = false;
    // 'close' fires on normal end, client abort and destroy alike.
    res.on('close', () => {
      closed = true;
      release();
    });
    if (owner()) {
      clearTimeout(this.held!.timer);
    } else if (serialize) {
      const free = await this.acquire();
      if (lock === 'hold') this.held = { session, release: free };
      else release = free;
    }
    if (lock && owner()) {
      const h = this.held!;
      // Hold: keep the lock after this request (until release or idle expiry). Release: free it when done.
      release = lock === 'hold' ? () => (h.timer = setTimeout(() => this.drop(h), this.holdTimeoutMs)) : () => this.drop(h);
    }
    if (closed) return release();
    const timeout = serialize ? this.initTimeoutMs : 0;
    const up = http.request(
      { hostname: this.target.hostname, port: this.target.port, path: req.url, method: req.method, headers, timeout },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    const fail = (status: number, msg: string): void => {
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(msg);
      } else {
        res.destroy();
      }
      up.destroy();
    };
    up.on('timeout', () => fail(504, `CPN IDE backend did not answer ${route} within ${timeout / 1000} s`));
    up.on('error', (e) => fail(502, `CPN IDE backend unreachable: ${e.message}`));
    res.on('close', () => up.destroy());
    req.pipe(up);
  }
}
