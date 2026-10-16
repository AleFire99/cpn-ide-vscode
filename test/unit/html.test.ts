import { describe, expect, it } from 'vitest';
import { decodeBytes, encodeText, fileName, PathAllowlist, toVsCodeFilters } from '../../src/webview/host-core';
import { buildCsp, buildWebviewHtml, safeJson } from '../../src/webview/html';

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
