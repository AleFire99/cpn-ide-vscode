import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const INIT_ROUTE = '/api/v2/cpn/init';

/**
 * Local reverse proxy in front of the backend. Two concurrent first `POST /api/v2/cpn/init` calls hang one of them
 * forever inside Access/CPN (Simulator.send), so inits go through a FIFO mutex; everything else passes through.
 */
export class InitProxy {
  private server: http.Server | undefined;
  private target = new URL('http://127.0.0.1');
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly initTimeoutMs = 120000) {}

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

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const serialize = req.method === 'POST' && (req.url ?? '').split('?')[0] === INIT_ROUTE;
    let release = (): void => {};
    let closed = false;
    // 'close' fires on normal end, client abort and destroy alike.
    res.on('close', () => {
      closed = true;
      release();
    });
    if (serialize) {
      release = await this.acquire();
      if (closed) return release();
    }
    const timeout = serialize ? this.initTimeoutMs : 0;
    const up = http.request(
      { hostname: this.target.hostname, port: this.target.port, path: req.url, method: req.method, headers: req.headers, timeout },
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
    up.on('timeout', () => fail(504, `CPN IDE backend did not answer ${INIT_ROUTE} within ${timeout / 1000} s`));
    up.on('error', (e) => fail(502, `CPN IDE backend unreachable: ${e.message}`));
    res.on('close', () => up.destroy());
    req.pipe(up);
  }
}
