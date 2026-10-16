/* CPN IDE webview shim.
 * The CPN IDE UI is an Angular app written for Electron. It checks navigator.userAgent for
 * "Electron" and uses window.require('electron') (remote.dialog, remote.require('fs'), shell, ...).
 * This script emulates just that surface on top of the VS Code webview message channel, and
 * serves the opened document as the UI's startup model. Plain JS, loaded before the app scripts.
 */
(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var cfg = window.__CPN__ || { mode: 'standalone' };

  // The UI logs full request/response payloads; keep that out of the way unless cpnIde.debug is on.
  if (!cfg.debug) {
    ['log', 'debug', 'info'].forEach(function (n) { console[n] = function () {}; });
  }

  // --- request/response bridge to the extension host ---
  var pending = {};
  var nextId = 1;
  function request(op, args) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      vscode.postMessage({ type: 'req', id: id, op: op, args: args || {} });
    });
  }
  function notify(op, args) {
    vscode.postMessage({ type: 'notify', op: op, args: args || {} });
  }
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.type !== 'res') return;
    var p = pending[m.id];
    if (!p) return;
    delete pending[m.id];
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || 'request failed'));
  });

  // --- pretend to be Electron ---
  try {
    var ua = navigator.userAgent + ' Electron/CPN-VSCode';
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: function () { return ua; } });
  } catch (e) {
    console.error('CPN shim: cannot override userAgent', e);
  }

  function lastArgCallback(args) {
    for (var i = args.length - 1; i >= 0; i--) if (typeof args[i] === 'function') return args[i];
    return null;
  }

  var fs = {
    readFile: function (path) {
      var cb = lastArgCallback(arguments);
      request('readFile', { path: path }).then(
        function (text) { if (cb) cb(null, text); },
        function (err) { if (cb) cb(err); },
      );
    },
    writeFile: function (path, data) {
      var cb = lastArgCallback(arguments);
      request('writeFile', { path: path, data: String(data) }).then(
        function () { if (cb) cb(null); },
        function (err) { if (cb) cb(err); },
      );
    },
    // The UI ignores the result of the sync variant, so this is fire-and-forget.
    writeFileSync: function (path, data) {
      notify('writeFile', { path: path, data: String(data) });
    },
  };

  function BrowserWindow() {}
  BrowserWindow.prototype.loadURL = function (url) { notify('openExternal', { url: String(url) }); };
  ['on', 'once', 'setMenu', 'setMenuBarVisibility', 'show', 'close', 'focus', 'removeMenu'].forEach(function (n) {
    BrowserWindow.prototype[n] = function () {};
  });

  var dialog = {
    showOpenDialog: function (options, cb) {
      request('showOpenDialog', { options: options || {} }).then(
        function (paths) { if (cb) cb(paths); },
        function () { if (cb) cb(undefined); },
      );
    },
    showSaveDialog: function (options, cb) {
      request('showSaveDialog', { options: options || {} }).then(
        function (p) { if (cb) cb(p || undefined); },
        function () { if (cb) cb(undefined); },
      );
    },
  };

  var electron = {
    dialog: dialog,
    BrowserWindow: BrowserWindow,
    shell: { openExternal: function (url) { notify('openExternal', { url: String(url) }); return Promise.resolve(true); } },
    ipcRenderer: { on: function () {}, once: function () {}, send: function () {}, removeListener: function () {} },
    webFrame: { setZoomFactor: function () {}, setZoomLevel: function () {} },
  };
  electron.remote = {
    dialog: dialog,
    BrowserWindow: BrowserWindow,
    getCurrentWindow: function () { return new BrowserWindow(); },
    require: function (name) {
      if (name === 'fs') return fs;
      if (name === 'electron') return electron;
      throw new Error('CPN shim: unsupported module ' + name);
    },
  };

  window.require = function (name) {
    if (name === 'electron') return electron;
    if (name === 'fs') return fs;
    throw new Error('CPN shim: unsupported module ' + name);
  };

  // --- startup model: answer assets/cpn/mynet.cpn with the opened document ---
  // Call back once the Angular root component has rendered something.
  function whenRendered(cb) {
    var tries = 0;
    (function poll() {
      var root = document.querySelector('app-root');
      if (root && root.children.length > 0) return cb();
      if (++tries > 600) return notify('error', { message: 'app-root never rendered' });
      setTimeout(poll, 100);
    })();
  }

  var STARTUP = /assets\/cpn\/mynet\.cpn(\?|$)/;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cpnUrl = String(url);
    this.__cpnStartup = STARTUP.test(this.__cpnUrl);
    if (this.__cpnStartup) {
      this.addEventListener('load', function () { whenRendered(function () { notify('ready', {}); }); });
      this.addEventListener('error', function () { notify('error', { message: 'startup model request failed' }); });
    }
    if (!this.__cpnStartup) {
      // Surface backend failures (e.g. simulator could not start) that the UI itself swallows.
      this.addEventListener('loadend', function () {
        if (this.status !== 500 || !/\/api\//.test(this.__cpnUrl)) return;
        var text = '';
        try { text = typeof this.responseText === 'string' ? this.responseText : JSON.stringify(this.response); } catch (e) { /* binary */ }
        notify('uiError', { url: this.__cpnUrl, status: 500, text: String(text).slice(0, 500) });
      });
    }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (xhr.__cpnStartup && typeof cfg.initialXml === 'string') {
      var define = function (k, v) { Object.defineProperty(xhr, k, { configurable: true, value: v }); };
      setTimeout(function () {
        define('readyState', 4);
        define('status', 200);
        define('statusText', 'OK');
        define('responseURL', String(xhr.__cpnUrl || ''));
        define('response', cfg.initialXml);
        define('responseText', cfg.initialXml);
        define('getAllResponseHeaders', function () { return 'content-type: text/plain\r\n'; });
        define('getResponseHeader', function (h) { return /^content-type$/i.test(h) ? 'text/plain' : null; });
        ['readystatechange', 'load', 'loadend'].forEach(function (t) { xhr.dispatchEvent(new Event(t)); });
      }, 0);
      return;
    }
    return origSend.apply(this, arguments);
  };

  window.addEventListener('error', function (e) {
    notify('error', { message: String(e.message || e) });
  });
  window.addEventListener('unhandledrejection', function (e) {
    notify('error', { message: 'unhandled rejection: ' + String(e.reason) });
  });
})();
