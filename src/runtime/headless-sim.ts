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
  const api = async <T>(route: string, body?: unknown): Promise<T> => {
    const res = await o.fetch(`${o.baseUrl}/api/v2/cpn/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SessionId': o.sessionId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  };

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
}

export function formatResult(r: SimResult): string[] {
  if (!r.ok) return ['Validation failed:', ...Object.entries(r.issues).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)];
  const lines = [`Simulated ${r.steps} step(s) in ${r.elapsedMs} ms${r.final.enableTrans.length ? '' : ' (no transition enabled)'}`];
  lines.push('Final marking:');
  for (const t of r.final.tokensAndMark) lines.push(`  ${t.id}: ${t.marking.replace(/\s+/g, ' ').trim()}`);
  return lines;
}
