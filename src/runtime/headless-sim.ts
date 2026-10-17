/**
 * Run a model on the backend without the UI. No `vscode` import so it is unit-testable with a fake fetch.
 */

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface SimState {
  enableTrans: string[];
  tokensAndMark: { id: string; tokens?: number; marking: string }[];
}

export type SimResult =
  | { ok: false; issues: Record<string, unknown> }
  | { ok: true; steps: number; elapsedMs: number; final: SimState };

export interface HeadlessOptions {
  fetch: FetchLike;
  baseUrl: string;
  xml: string;
  /** Maximum number of steps. */
  maxSteps: number;
  sessionId: string;
  now?: () => number;
  onStep?: (steps: number) => void;
}

/** Validate the model, initialise the simulator and step until nothing is enabled or maxSteps is reached. */
export async function runHeadless(o: HeadlessOptions): Promise<SimResult> {
  const now = o.now ?? Date.now;
  // The extension's proxy honours X-CPN-Lock: our session keeps the init lock from init to the last step, so the
  // canvas cannot create a net (and restart the shared simulator) in between. Other backends simply ignore it.
  const api = async <T>(route: string, body?: unknown, lock: 'hold' | 'release' = 'hold'): Promise<T> => {
    const res = await o.fetch(`${o.baseUrl}/api/v2/cpn/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SessionId': o.sessionId, 'X-CPN-Lock': lock },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  };

  try {
    const check = await api<{ success: boolean; issues?: Record<string, unknown> }>('init', {
      xml: o.xml,
      complex_verify: true,
      need_sim_restart: true,
    });
    const issues = check.issues ?? {};
    if (!check.success || Object.keys(issues).length > 0) return { ok: false, issues };

    let state = await api<SimState>('sim/init', {});
    const start = now();
    let steps = 0;
    while (steps < o.maxSteps && state.enableTrans.length > 0) {
      state = await api<SimState>('sim/step/multistep');
      steps++;
      o.onStep?.(steps);
    }
    return { ok: true, steps, elapsedMs: now() - start, final: state };
  } finally {
    await api('', undefined, 'release').catch(() => undefined);
  }
}

/** Result lines; `names` maps simulator ids to readable names (see nodeNames), unknown ids are printed as they are. */
export function formatResult(r: SimResult, names: ReadonlyMap<string, string> = new Map()): string[] {
  const name = (id: string) => names.get(id) ?? id;
  if (!r.ok) return ['Validation failed:', ...Object.entries(r.issues).map(([k, v]) => `  ${name(k)}: ${JSON.stringify(v)}`)];
  const lines = [`Simulated ${r.steps} step(s) in ${r.elapsedMs} ms${r.final.enableTrans.length ? '' : ' (no transition enabled)'}`];
  lines.push('Final marking:');
  const rows = r.final.tokensAndMark.map((t) => [name(t.id), t.marking.replace(/\s+/g, ' ').trim() || 'empty'] as const);
  const width = Math.max(0, ...rows.map(([n]) => n.length));
  for (const [n, m] of rows) lines.push(`  ${n.padEnd(width)}  ${m}`);
  if (r.final.enableTrans.length) lines.push(`Still enabled: ${r.final.enableTrans.map(name).join(', ')}`);
  return lines;
}

/** Remove ANSI colour/control sequences (the backend's logback output uses them). */
export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
