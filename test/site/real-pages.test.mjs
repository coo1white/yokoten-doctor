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
        const has = await evaluate('!!document.querySelector(".f-job")');
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
        const items = await evaluate(`(() => { const els = [...document.querySelectorAll('.wide')]; const out=[]; for (const el of els) { const rect = el.getBoundingClientRect(); if (rect.width===0 || rect.height===0) continue; const style=getComputedStyle(el); const left=Math.round(rect.left+parseFloat(style.paddingLeft)); const right=Math.round(rect.right-parseFloat(style.paddingRight)); out.push({cls: el.className, left, right}); } return out; })()`);
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

  test('one step is open at a time', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/Uniswap-v4-core.html', 1440);
    const count = await evaluate('document.querySelectorAll(\'details[name="steps"]\').length');
    assert.equal(count, 3);
    const openIds = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(\'details[name="steps"][open]\')].map(e=>e.id))') || '[]');
    assert.deepEqual(openIds, ['step-files']);
    await evaluate('document.querySelector("#step-install summary").click()');
    await new Promise((r) => setTimeout(r, 100));
    const openIds2 = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(\'details[name="steps"][open]\')].map(e=>e.id))') || '[]');
    assert.deepEqual(openIds2, ['step-install']);
  });

  test('only a long file row has a read fold', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/Uniswap-v4-core.html', 1440);
    const rowsWithFold = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("[data-file-list] .file")].map((row) => ({ isLong: row.querySelector("[data-add]").textContent.includes("Copy and open"), hasFold: row.querySelector(".file-read details") !== null })))'));
    assert.ok(rowsWithFold.length > 0, 'the page lists files');
    for (const row of rowsWithFold) assert.equal(row.hasFold, row.isLong);
  });

  test('marking a step done leaves the count and the bar alone', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/Uniswap-v4-core.html', 1440);
    const startVerdict = await evaluate('document.querySelector("h1.f-verdict").textContent.trim()');
    const startBar = await evaluate('JSON.stringify([...document.querySelectorAll(".f-main .bar i")].map(e=>e.className))');
    for (let i = 0; i < 3; i++) {
      await evaluate('document.querySelector(".f-step[open] [data-done]").click()');
      await new Promise((r) => setTimeout(r, 100));
      const verdict = await evaluate('document.querySelector("h1.f-verdict").textContent.trim()');
      assert.equal(verdict, startVerdict);
      const bar = await evaluate('JSON.stringify([...document.querySelectorAll(".f-main .bar i")].map(e=>e.className))');
      assert.equal(bar, startBar);
      if (i === 0) {
        const isDone = await evaluate('document.getElementById("step-files").classList.contains("is-done")');
        assert.equal(isDone, true);
        const openIds = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(\'details[name="steps"][open]\')].map(e=>e.id))') || '[]');
        assert.deepEqual(openIds, ['step-install']);
      }
      if (i === 2) {
        const openCount = await evaluate('document.querySelectorAll(\'details[name="steps"][open]\').length');
        assert.equal(openCount, 0);
        const hidden = await evaluate('document.querySelector("[data-all-done]").hidden');
        assert.equal(hidden, false);
        const href = await evaluate('document.querySelector("[data-all-done] a").href');
        assert.ok(href.includes("/?repo="));
        const activeIsLink = await evaluate('document.activeElement === document.querySelector("[data-all-done] a")');
        assert.equal(activeIsLink, true);
      }
    }
  });

  test('each step row says where it gets you', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/Uniswap-v4-core.html', 1440);
    const texts = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".f-gets")].map(e=>e.textContent.trim()))') || '[]');
    assert.deepEqual(texts, ['gets you to 7 of 13', 'gets you to 12 of 13', 'gets you to 13 of 13']);
  });

  test('a page with one step has no number and no accordion', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/cline-cline.html', 1440);
    assert.equal(await evaluate('document.querySelectorAll(\'details[name="steps"]\').length'), 0);
    assert.equal(await evaluate('document.querySelectorAll(".f-num").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("[data-done]").length'), 0);
    const h2 = await evaluate('document.querySelector(".f-single h2").textContent.trim()');
    assert.equal(h2, 'Run one command to get to 13 of 13');
    const linkText = await evaluate('document.querySelector(".f-single .f-next a").textContent.trim()');
    assert.equal(linkText, 'Done? Run the check again');
  });

  test('what is required and what is optional are separate', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const examplePages = pages.filter((p) => p.startsWith('/example/'));
    for (const pagePath of examplePages) {
      await navigate(pagePath, 1440);
      assert.equal(await evaluate('document.querySelectorAll(".f-rest .f-job").length'), 0, `${pagePath} .f-rest .f-job should be 0`);
      assert.equal(await evaluate('document.querySelectorAll(".f-job .f-rest").length'), 0, `${pagePath} .f-job .f-rest should be 0`);
      assert.equal(await evaluate('document.querySelectorAll(".f-rest [data-done]").length'), 0, `${pagePath} .f-rest [data-done] should be 0`);
      assert.equal(await evaluate('document.querySelectorAll(".f-job .f-row").length'), 0, `${pagePath} .f-job .f-row should be 0`);
      const h2 = await evaluate('document.querySelector(".f-rest > h2").textContent.trim()');
      assert.equal(h2, 'Nothing below is required', `${pagePath} .f-rest > h2 should be Nothing below is required, got ${h2}`);
      const before = await evaluate('!!(document.querySelector(".f-job").compareDocumentPosition(document.querySelector(".f-rest")) & 4)');
      assert.ok(before, `${pagePath} .f-job should come before .f-rest`);
      const rowCount = await evaluate('document.querySelectorAll(".f-rest .f-row").length');
      assert.ok(rowCount >= 2, `${pagePath} .f-rest .f-row should be at least 2, got ${rowCount}`);
    }
  });

  test('no rail, no step bar, no legend, no dark card, no closing block', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const examplePages = pages.filter((p) => p.startsWith('/example/'));
    for (const pagePath of examplePages) {
      for (const w of [1440, 390]) {
        await navigate(pagePath, w);
        const count = await evaluate('document.querySelectorAll(".rail, .stepbar, .legend, .next, .close, [data-steps]").length');
        assert.equal(count, 0, `${pagePath} width ${w} should have no old blocks`);
        const text = await evaluate('document.body.innerText');
        for (const s of ['Do this first', 'Made the changes?', 'Step 1 of']) {
          assert.equal(text.includes(s), false, `${pagePath} should not contain "${s}"`);
        }
      }
    }
  });

  test('nothing scrolls sideways with every row open', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const examplePages = pages.filter((p) => p.startsWith('/example/'));
    for (const pagePath of examplePages) {
      await navigate(pagePath, 390);
      await evaluate('document.querySelectorAll(".f-rest details").forEach(d=>d.open=true); document.querySelectorAll(".f-rest details details").forEach(d=>d.open=true)');
      const ok = await evaluate('document.documentElement.scrollWidth <= window.innerWidth');
      assert.ok(ok, `${pagePath} should not scroll sideways with every row open`);
    }
  });
});
