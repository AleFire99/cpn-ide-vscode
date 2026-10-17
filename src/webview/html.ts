/**
 * Pure HTML construction for the CPN IDE webview. No `vscode` import so it is unit-testable.
 */

export interface CpnConfig {
  /** 'editor' = custom editor bound to a document, 'standalone' = free panel. */
  mode: 'editor' | 'standalone';
  /** Name shown/used for the initial model. */
  fileName?: string;
  /** Path (document URI string) the UI should treat as the current file in editor mode. */
  filePath?: string;
  /** XML returned for the UI's startup request of assets/cpn/mynet.cpn. */
  initialXml?: string;
  /** Delay between steps of multi-step simulation, in ms (UI default: 500). */
  stepDelayMs?: number;
  /** Animate token movement in the UI. */
  animate?: boolean;
  /** Keep the UI's verbose console.log output. */
  debug?: boolean;
  /** cpnIde.theme: 'auto' follows the VS Code colour theme, 'light' keeps the UI's own light look. */
  theme?: ThemeSetting;
}

export type ThemeSetting = 'auto' | 'light';

/** Anything other than an explicit 'light' (including a missing or garbled value) means 'auto'. */
export function normalizeTheme(v: unknown): ThemeSetting {
  return v === 'light' ? 'light' : 'auto';
}

/** Whether the dark stylesheet and its body-class watcher are injected at all. */
export function useDarkTheme(theme: ThemeSetting | undefined): boolean {
  return normalizeTheme(theme) === 'auto';
}

/**
 * Whether the class list of the webview <body> describes a dark theme. VS Code sets one of
 * vscode-light, vscode-dark, vscode-high-contrast (plus vscode-high-contrast-light for the light variant).
 */
export function isDarkBodyClass(classes: string): boolean {
  const c = classes.split(/\s+/);
  return c.includes('vscode-dark') || (c.includes('vscode-high-contrast') && !c.includes('vscode-high-contrast-light'));
}

export interface BuildHtmlOptions {
  /** Contents of resources/ui/index.html. */
  indexHtml: string;
  /** Maps a path relative to resources/ui to a webview URI string. */
  mapUri: (relativePath: string) => string;
  /** Webview URI of the resources/ui directory (with or without trailing slash). */
  baseUri: string;
  /** Webview URI of media/shim.js. */
  shimUri: string;
  /** Webview URI of media/dark-theme.css. Only used when config.theme is not 'light'. */
  darkThemeUri?: string;
  /** webview.cspSource */
  cspSource: string;
  nonce: string;
  backendUrl: string;
  config: CpnConfig;
}

/** The UI's built-in application settings (CG in main.js); used when none are stored yet. */
const DEFAULT_SETTINGS = {
  serverAddress: 'http://localhost:8080',
  globref: 'globref CONST = 1;',
  color: 'colset TYPE = unit;',
  var: 'var v:UNIT;',
  fun: 'fun Fun1() = [];',
  type: 'UNIT',
  initmark: 'empty',
  code: 'input();\noutput();\naction();',
  cond: '[]',
  time: '@+',
  priority: 'P_NORMAL',
  annot: '1`()',
  block: 'New block',
  monitorblock: 'New monitor block',
  declaration: '(* New declaration *)',
  page: 'New page',
  ellipse: { h: 40, w: 70 },
  box: { h: 40, w: 70 },
};

export function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** JSON that is safe to embed inside an inline <script>. */
export function safeJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildCsp(cspSource: string, nonce: string, backendUrl: string): string {
  return [
    `default-src 'none'`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `frame-src ${cspSource}`,
    `font-src ${cspSource} data:`,
    `img-src ${cspSource} data: blob:`,
    `connect-src ${backendUrl} ${cspSource}`,
  ].join('; ');
}

const isAbsolute = (u: string) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

function bootstrapScript(backendUrl: string, config: CpnConfig): string {
  return `(function(){
  var cfg = ${safeJson(config)};
  var backend = ${safeJson(backendUrl)};
  var defaults = ${safeJson(DEFAULT_SETTINGS)};
  window.__CPN__ = { mode: cfg.mode, fileName: cfg.fileName, filePath: cfg.filePath, initialXml: cfg.initialXml, stepDelayMs: cfg.stepDelayMs, animate: cfg.animate, debug: cfg.debug, backendUrl: backend };
  try {
    var stored = localStorage.getItem('applicationSettings');
    var s = stored ? JSON.parse(stored) : {};
    var merged = {};
    for (var k in defaults) merged[k] = defaults[k];
    for (var k2 in s) merged[k2] = s[k2];
    merged.serverAddress = backend;
    localStorage.setItem('applicationSettings', JSON.stringify(merged));
  } catch (e) { console.error('CPN IDE: could not set backend URL', e); }
})();`;
}

/**
 * Inline script that mirrors the body's dark VS Code theme classes onto <html> as `cpn-dark`
 * (the scope of media/dark-theme.css). The UI shares the webview's document, so the body classes
 * VS Code sets (and updates on a theme switch) are directly observable. Same rule as isDarkBodyClass.
 */
export function darkThemeScript(): string {
  return `(function(){
  var root = document.documentElement;
  var watching = false;
  function sync() {
    var b = document.body;
    if (!b) return;
    var c = b.classList;
    var dark = c.contains('vscode-dark') || (c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light'));
    root.classList.toggle('cpn-dark', dark);
    if (!watching && typeof MutationObserver === 'function') {
      watching = true;
      new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['class'] });
    }
  }
  sync();
  document.addEventListener('DOMContentLoaded', sync);
})();`;
}

/** Build the final webview HTML from the UI's index.html. */
export function buildWebviewHtml(o: BuildHtmlOptions): string {
  const base = o.baseUri.endsWith('/') ? o.baseUri : o.baseUri + '/';
  let html = o.indexHtml;

  // Drop the original <base> and any inline event handlers (blocked by CSP).
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/\sonload="[^"]*"/gi, '');

  // Rewrite relative src/href to webview URIs.
  html = html.replace(/(\s(?:src|href)=)(["'])([^"']*)\2/gi, (m, pre: string, q: string, url: string) => {
    if (!url || isAbsolute(url)) return m;
    const rel = url.replace(/^\.\//, '');
    return `${pre}${q}${o.mapUri(rel)}${q}`;
  });

  // Nonce on every remaining <script>.
  html = html.replace(/<script\b(?![^>]*\snonce=)/gi, `<script nonce="${o.nonce}"`);

  const dark = useDarkTheme(o.config.theme) && !!o.darkThemeUri;

  const inject = [
    `<meta http-equiv="Content-Security-Policy" content="${buildCsp(o.cspSource, o.nonce, o.backendUrl)}">`,
    `<base href="${base}">`,
    `<script nonce="${o.nonce}">${bootstrapScript(o.backendUrl, o.config)}</script>`,
    `<script nonce="${o.nonce}" src="${o.shimUri}"></script>`,
    ...(dark ? [`<script nonce="${o.nonce}">${darkThemeScript()}</script>`] : []),
  ].join('\n');
  // After the UI's own styles, so equal-specificity rules in the dark sheet win.
  const tail = dark ? `<link rel="stylesheet" href="${o.darkThemeUri}">` : '';

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`);
    return tail ? html.replace(/<\/head>/i, () => `${tail}</head>`) : html;
  }
  return `<!doctype html><html><head>${inject}${tail}</head><body>${html}</body></html>`;
}
