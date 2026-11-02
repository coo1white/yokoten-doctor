import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const distDir = path.resolve('dist');
const examplesDir = path.resolve('web/src/data/examples');

describe('real pages', () => {
  let server;
  let serverPort;
  let browserProc = null;
  let tmpDir = null;
  let cdpPort = null;
  let wsUrl = null;
  let ws = null;
  let targetId = null;
  let skipReason = null;
  let siteHost = process.env.SITE_ORIGIN_HOST || '127.0.0.1';
  let usingExternal = false;
  let send;

  const pages = [];
  const widths = [
    { w: 1440, left: 140, right: 1300 },
    { w: 768, left: 32, right: 736 },
    { w: 390, left: 16, right: 374 },
  ];

  function contentType(p) {
    const ext = path.extname(p).toLowerCase();
    const map = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.txt': 'text/plain',
      '.xml': 'application/xml',
    };
    return map[ext] || 'application/octet-stream';
  }

  function makeSend() {
    let id = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { const fn = pending.get(msg.id); pending.delete(msg.id); fn(msg); }
    };
    return function sendFn(method, params = {}) {
      return new Promise((resolve, reject) => {
        const cur = id++;
        pending.set(cur, resolve);
        ws.send(JSON.stringify({ id: cur, method, params }));
        setTimeout(() => { if (pending.has(cur)) { pending.delete(cur); reject(new Error('cdp timeout ' + method)); } }, 15000);
      });
    };
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails || (res.result && res.result.exceptionDetails)) {
      throw new Error('evaluate exception: ' + JSON.stringify(res.exceptionDetails || res.result.exceptionDetails));
    }
    if (res.result && res.result.result) return res.result.result.value;
    if (res.result && 'value' in res.result) return res.result.value;
    return res.result;
  }

  async function navigate(pagePath, width) {
    await send('Emulation.setDeviceMetricsOverride', { width: width, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = `http://${siteHost}:${serverPort}${pagePath}`;
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const val = await evaluate('document.readyState');
      if (val === 'complete') break;
    }
    if (pagePath.includes('/example/')) {
      for (let i = 0; i < 30; i++) {
        const has = await evaluate('!!document.querySelector("[data-steps]")');
        if (has) break;
        await new Promise((res) => setTimeout(res, 200));
      }
    }
  }

  before(async () => {
    for (const name of ['/', '/about.html', '/agent-view.html', '/404.html']) pages.push(name);
    if (fs.existsSync(examplesDir)) {
      const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        const slug = path.basename(f, '.json');
        pages.push(`/example/${slug}.html`);
      }
    }

    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname = url.pathname;
      if (pathname === '/') pathname = '/index.html';
      const safe = path.resolve(distDir, '.' + pathname);
      if (!safe.startsWith(distDir)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      if (!fs.existsSync(safe) || fs.statSync(safe).isDirectory()) {
        const nf = path.join(distDir, '404.html');
        const html = fs.existsSync(nf) ? fs.readFileSync(nf, 'utf8') : 'not found';
        res.writeHead(404, { 'Content-Type': 'text/html' }); res.end(html); return;
      }
      const data = fs.readFileSync(safe);
      res.writeHead(200, { 'Content-Type': contentType(safe) });
      res.end(data);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    serverPort = server.address().port;

    let browserHttpPort = null;
    let wsEndpoint = null;

    if (process.env.CHROME_CDP) {
      const u = new URL(process.env.CHROME_CDP);
      browserHttpPort = Number(u.port);
      usingExternal = true;
      cdpPort = browserHttpPort;
      siteHost = process.env.SITE_ORIGIN_HOST || '127.0.0.1';
    } else {
      const candidates = [];
      if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
      candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
      let bin = null;
      for (const name of candidates) {
        try { execFileSync(name, ['--version'], { stdio: 'ignore' }); bin = name; break; } catch {}
      }
      if (!bin) {
        skipReason = 'no browser available, see built-site.test.mjs tests still ran';
        return;
      }
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
      browserProc = spawn(bin, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=0',
        `--user-data-dir=${tmpDir}`,
        'about:blank',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      const stderrChunks = [];
      const portPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('browser start timeout')), 20000);
        browserProc.stderr.on('data', (chunk) => {
          const s = chunk.toString();
          stderrChunks.push(s);
          const m = s.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
          if (m) { clearTimeout(timer); resolve(Number(m[1])); }
        });
        browserProc.on('error', reject);
      });
      try {
        browserHttpPort = await portPromise;
        cdpPort = browserHttpPort;
      } catch (e) {
        skipReason = 'browser would not start, see built-site.test.mjs tests still ran: ' + e.message;
        return;
      }
    }

    function httpRequest(opts) {
      return new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.end();
      });
    }
    try {
      const r = await httpRequest({ host: '127.0.0.1', port: cdpPort, path: '/json/new?about:blank', method: 'PUT' });
      const info = JSON.parse(r.data);
      wsUrl = info.webSocketDebuggerUrl;
      targetId = info.id;
    } catch (e) {
      skipReason = 'could not create CDP target, see built-site.test.mjs tests still ran: ' + e.message;
      return;
    }
    ws = new WebSocket(wsUrl);
    await once(ws, 'open');
    send = makeSend();
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setScrollbarsHidden', { hidden: true });
  });

  after(async () => {
    if (ws) { try { ws.close(); } catch {} }
    if (cdpPort && targetId) {
      await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: cdpPort, path: `/json/close/${targetId}`, method: 'GET' }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', resolve); req.end();
      });
    }
    if (server) await new Promise((r) => server.close(r));
    if (browserProc) { try { browserProc.kill(); } catch {} }
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  });

  test('one container: on every page and width, the header, footer and every container share one left and right edge', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    for (const pagePath of pages) {
      for (const { w, left: expLeft, right: expRight } of widths) {
        await navigate(pagePath, w);
        const items = await evaluate(`(() => { const els = [...document.querySelectorAll('.wide, .sum-in, .steps-grid')]; const out=[]; for (const el of els) { const rect = el.getBoundingClientRect(); if (rect.width===0 || rect.height===0) continue; const style=getComputedStyle(el); const left=Math.round(rect.left+parseFloat(style.paddingLeft)); const right=Math.round(rect.right-parseFloat(style.paddingRight)); out.push({cls: el.className, left, right}); } return out; })()`);
        for (const it of items) {
          assert.equal(it.left, expLeft, `${pagePath} width ${w} ${it.cls} left ${it.left} != ${expLeft}`);
          assert.equal(it.right, expRight, `${pagePath} width ${w} ${it.cls} right ${it.right} != ${expRight}`);
        }
      }
    }
  });

  test('no page scrolls sideways at any width', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    for (const pagePath of pages) {
      for (const { w } of widths) {
        await navigate(pagePath, w);
        const ok = await evaluate('document.documentElement.scrollWidth <= window.innerWidth');
        assert.ok(ok, `${pagePath} width ${w} should not scroll sideways: scrollWidth > innerWidth`);
      }
    }
  });

  test('one record link on each result page', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const examplePages = pages.filter((p) => p.startsWith('/example/'));
    for (const pagePath of examplePages) {
      await navigate(pagePath, 1440);
      await evaluate('document.querySelectorAll("#verify details").forEach(d=>d.open=true)');
      const count = await evaluate('document.querySelectorAll("#verify a[href*=\\"sigstore\\"], #verify a[href*=\\"solana\\"]").length');
      assert.equal(count, 1, `${pagePath} should have exactly 1 sigstore/solana link`);
      const href = await evaluate('document.querySelector("#verify a[href*=\\"sigstore\\"], #verify a[href*=\\"solana\\"]").href');
      assert.ok(href.includes('sigstore'), `${pagePath} link should hold sigstore, got ${href}`);
      const txt = await evaluate('document.querySelector("#verify").innerText');
      assert.equal(txt.includes('The HOME part'), false, `${pagePath} #verify should not contain The HOME part`);
    }
  });

  test('step counts: only steps that move the count are numbered', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const examplePages = pages.filter((p) => p.startsWith('/example/'));
    for (const pagePath of examplePages) {
      await navigate(pagePath, 1440);
      const N = await evaluate('document.querySelectorAll(".rail li:not(.rail-extra)").length');
      assert.ok(N > 0, `${pagePath} rail count N should be >0`);
      const railText = (await evaluate('document.querySelector(".rail-count").textContent') || '').trim();
      assert.equal(railText, `Step 1 of ${N}`, `${pagePath} .rail-count should be Step 1 of ${N}, got ${railText}`);
      const stepCount = await evaluate('document.querySelectorAll("section.step[data-no]").length');
      assert.equal(stepCount, N, `${pagePath} section.step[data-no] should be ${N}`);
      const hasPrivateNo = await evaluate('(() => { const el=document.querySelector("#private"); return el ? el.hasAttribute("data-no") : false; })()');
      assert.equal(hasPrivateNo, false, `${pagePath} #private should have no data-no`);
      const hasVerifyNo = await evaluate('(() => { const el=document.querySelector("#verify"); return el ? el.hasAttribute("data-no") : false; })()');
      assert.equal(hasVerifyNo, false, `${pagePath} #verify should have no data-no`);
      const verifyExists = await evaluate('!!document.querySelector("#verify")');
      assert.ok(verifyExists, `${pagePath} #verify should be on the page`);
    }
  });

  test('no command shows twice on a page', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const checkPages = pages.filter((p) => p.startsWith('/example/'));
    checkPages.push('/', '/agent-view.html');
    for (const pagePath of checkPages) {
      await navigate(pagePath, 1440);
      await evaluate('document.querySelectorAll("details").forEach(d=>d.open=true)');
      const arr = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".cmd code, .hash code")].map(e=>e.textContent.trim()))') || '[]');
      assert.ok(arr.length > 0, `${pagePath} should have at least one command`);
      const seen = new Set();
      for (const c of arr) {
        assert.equal(seen.has(c), false, `${pagePath} command should not repeat: ${c}`);
        seen.add(c);
      }
    }
  });

  test('a jump to a step marks it in the rail', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/Uniswap-v4-core.html', 1440);
    await evaluate('document.querySelector(\'.rail [data-step-link="install"]\').click()');
    const cur = await evaluate('document.querySelector(\'.rail [data-step-link="install"]\').getAttribute("aria-current")');
    assert.equal(cur, 'step');
    const count = await evaluate('document.querySelector(".rail-count").textContent');
    assert.equal((count || '').trim(), 'Step 2 of 3');
  });
});
