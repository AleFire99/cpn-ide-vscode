import { describe, expect, it } from 'vitest';
import { decodeBytes, encodeText, fileName, PathAllowlist, toVsCodeFilters } from '../../src/webview/host-core';
import { buildCsp, buildWebviewHtml, darkThemeScript, isDarkBodyClass, normalizeTheme, safeJson, useDarkTheme } from '../../src/webview/html';

const INDEX = `<!doctype html>
<html><head>
<base href="./">
<script src="./assets/jquery.js" onload="if (typeof module !== 'undefined') window.$ = 1;"></script>
<link rel="stylesheet" href="./assets/a.css" crossorigin="anonymous">
<link rel="icon" href="favicon.ico">
<a href="https://example.com/x">ext</a>
<link rel="stylesheet" href="styles.abc.css"></head>
<body><app-root></app-root>
<script src="main.abc.js" defer></script></body></html>
<script>olLoad = function () {}</script>`;

const opts = {
  indexHtml: INDEX,
  mapUri: (r: string) => `https://wv.test/ui/${r}`,
  baseUri: 'https://wv.test/ui',
  shimUri: 'https://wv.test/media/shim.js',
  cspSource: 'https://wv.test',
  nonce: 'NONCE123',
  backendUrl: 'http://127.0.0.1:4567',
  config: { mode: 'editor' as const, fileName: 'a.cpn', initialXml: '<x>\u2028</script></x>' },
};

describe('buildWebviewHtml', () => {
  const html = buildWebviewHtml(opts);

  it('rewrites relative src/href but leaves absolute URLs', () => {
    expect(html).toContain('src="https://wv.test/ui/assets/jquery.js"');
    expect(html).toContain('href="https://wv.test/ui/assets/a.css"');
    expect(html).toContain('href="https://wv.test/ui/favicon.ico"');
    expect(html).toContain('src="https://wv.test/ui/main.abc.js"');
    expect(html).toContain('href="https://example.com/x"');
  });

  it('replaces <base> with the UI directory (trailing slash) and drops inline handlers', () => {
    expect(html.match(/<base /g)).toHaveLength(1);
    expect(html).toContain('<base href="https://wv.test/ui/">');
    expect(html).not.toContain('onload=');
  });

  it('adds the nonce to every script, including inline ones', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBe(5);
    for (const s of scripts) expect(s).toContain('nonce="NONCE123"');
  });

  it('has a CSP with backend, nonce and webview source', () => {
    const csp = buildCsp('https://wv.test', 'NONCE123', 'http://127.0.0.1:4567');
    expect(html).toContain(`content="${csp}"`);
    expect(csp).toContain("script-src https://wv.test 'nonce-NONCE123'");
    expect(csp).toContain('connect-src http://127.0.0.1:4567 https://wv.test');
    expect(csp).toContain("style-src https://wv.test 'unsafe-inline'");
    expect(csp).toContain('img-src https://wv.test data: blob:');
    expect(csp).toContain('frame-src https://wv.test');
    expect(csp).toContain('font-src https://wv.test data:');
  });

  it('injects bootstrap then shim before the app scripts', () => {
    const iBoot = html.indexOf('window.__CPN__');
    const iShim = html.indexOf('media/shim.js');
    const iJq = html.indexOf('assets/jquery.js');
    const iMain = html.indexOf('main.abc.js');
    expect(iBoot).toBeGreaterThan(0);
    expect(iBoot).toBeLessThan(iShim);
    expect(iShim).toBeLessThan(iJq);
    expect(iShim).toBeLessThan(iMain);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(iBoot);
  });

  it('passes simulation and debug settings into window.__CPN__', () => {
    const h = buildWebviewHtml({ ...opts, config: { mode: 'editor', stepDelayMs: 0, animate: false, debug: true } });
    expect(h).toContain('"stepDelayMs":0');
    expect(h).toContain('"animate":false');
    expect(h).toContain('"debug":true');
    expect(h).toContain('stepDelayMs: cfg.stepDelayMs, animate: cfg.animate, debug: cfg.debug');
  });

  it('embeds config safely and sets the backend URL', () => {
    expect(html).toContain('"http://127.0.0.1:4567"');
    expect(html).toContain('merged.serverAddress = backend');
    expect(html).not.toContain('</script></x>');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('\\u2028');
  });
});

describe('safeJson', () => {
  it('escapes < so embedded strings cannot close the script', () => {
    expect(safeJson({ a: '</script>' })).toBe('{"a":"\\u003c/script>"}');
  });
});

describe('host-core', () => {
  it('round-trips utf8 and latin1', () => {
    const utf = decodeBytes(Buffer.from('héllo', 'utf8'));
    expect(utf).toEqual({ text: 'héllo', encoding: 'utf8' });
    const lat = decodeBytes(Buffer.from([0x68, 0xe9]));
    expect(lat).toEqual({ text: 'hé', encoding: 'latin1' });
    expect(Buffer.from(encodeText(lat.text, lat.encoding))).toEqual(Buffer.from([0x68, 0xe9]));
  });

  it('derives file names and filters', () => {
    expect(fileName('/a/b/my%20net.cpn')).toBe('my net.cpn');
    expect(fileName('C:\\x\\y.cpn')).toBe('y.cpn');
    expect(toVsCodeFilters([{ name: 'CPN', extensions: ['cpn', '*'] }])).toEqual({ CPN: ['cpn'] });
    expect(toVsCodeFilters(undefined)).toBeUndefined();
  });
});

describe('PathAllowlist', () => {
  it('allows only registered paths', () => {
    const a = new PathAllowlist(['/a/doc.cpn']);
    expect(a.has('/a/doc.cpn')).toBe(true);
    expect(() => a.assert('/etc/passwd')).toThrow(/Access denied/);
    a.add('/b/other.cpn');
    expect(() => a.assert('/b/other.cpn')).not.toThrow();
  });
});

describe('dark theme', () => {
  const darkOpts = { ...opts, darkThemeUri: 'https://wv.test/media/dark-theme.css' };

  it('normalizes the setting and defaults to auto', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('auto')).toBe('auto');
    expect(normalizeTheme(undefined)).toBe('auto');
    expect(normalizeTheme('dark')).toBe('auto');
    expect(useDarkTheme(undefined)).toBe(true);
    expect(useDarkTheme('light')).toBe(false);
  });

  it('recognises dark and high-contrast body classes, but not light ones', () => {
    expect(isDarkBodyClass('vscode-dark')).toBe(true);
    expect(isDarkBodyClass('vscode-body vscode-dark vscode-reduce-motion')).toBe(true);
    expect(isDarkBodyClass('vscode-high-contrast')).toBe(true);
    expect(isDarkBodyClass('vscode-light')).toBe(false);
    expect(isDarkBodyClass('vscode-high-contrast vscode-high-contrast-light')).toBe(false);
    expect(isDarkBodyClass('')).toBe(false);
  });

  it('injects the stylesheet last in <head> and the watcher script with a nonce when auto', () => {
    const html = buildWebviewHtml({ ...darkOpts, config: { ...opts.config, theme: 'auto' } });
    expect(html).toContain('<link rel="stylesheet" href="https://wv.test/media/dark-theme.css"></head>');
    expect(html).toContain('<script nonce="NONCE123">(function(){');
    expect(html).toContain('cpn-dark');
    expect(html.indexOf('dark-theme.css')).toBeGreaterThan(html.indexOf('styles.abc.css'));
    expect(buildWebviewHtml(darkOpts)).toContain('dark-theme.css');
  });

  it('injects nothing when the theme is light or no stylesheet URI is given', () => {
    const light = buildWebviewHtml({ ...darkOpts, config: { ...opts.config, theme: 'light' } });
    expect(light).not.toContain('dark-theme.css');
    expect(light).not.toContain('cpn-dark');
    expect(buildWebviewHtml(opts)).not.toContain('cpn-dark');
  });

  describe('watcher script', () => {
    function run(bodyClasses: string[]) {
      const rootClasses = new Set<string>();
      const body = { classList: { contains: (c: string) => bodyClasses.includes(c) } };
      const observers: Array<() => void> = [];
      const doc = {
        documentElement: {
          classList: { toggle: (c: string, on: boolean) => void (on ? rootClasses.add(c) : rootClasses.delete(c)) },
        },
        body,
        addEventListener: () => undefined,
      };
      class FakeObserver {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
      }
      new Function('document', 'MutationObserver', darkThemeScript())(doc, FakeObserver);
      return { rootClasses, bodyClasses, observers };
    }

    it('marks <html> dark for dark themes and follows later class changes', () => {
      const r = run(['vscode-dark']);
      expect(r.rootClasses.has('cpn-dark')).toBe(true);
      expect(r.observers).toHaveLength(1);
      r.bodyClasses.splice(0, 1, 'vscode-light');
      r.observers[0]();
      expect(r.rootClasses.has('cpn-dark')).toBe(false);
    });

    it('stays light for light and high-contrast-light themes', () => {
      expect(run(['vscode-light']).rootClasses.has('cpn-dark')).toBe(false);
      expect(run(['vscode-high-contrast', 'vscode-high-contrast-light']).rootClasses.has('cpn-dark')).toBe(false);
      expect(run(['vscode-high-contrast']).rootClasses.has('cpn-dark')).toBe(true);
    });
  });
});
