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

  const liveExample = JSON.parse(fs.readFileSync(path.join(examplesDir, 'expressjs-express.json'), 'utf8'));

  async function openFakeCheck(query, events, extraScript = '', lateEvents = []) {
    const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: `${extraScript}
      const realFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (!String(url).includes('/api/check')) return realFetch(url, options);
        const events = ${JSON.stringify(events)};
        return new Response(new ReadableStream({ start(controller) {
          const encoder = new TextEncoder();
        const send = (list) => { for (const [name, data] of list) controller.enqueue(encoder.encode('event: ' + name + '\\ndata: ' + JSON.stringify(data) + '\\n\\n')); };
        send(events);
        const late = ${JSON.stringify(lateEvents)};
        if (late.length === 0) { controller.close(); return; }
        setTimeout(() => { send(late); controller.close(); }, 600);
        } }), { status: 200 });
      };` });
    await navigate('/' + query, 1440);
    for (let i = 0; i < 30; i++) {
      if (await evaluate('!!document.querySelector(".f-main h1")')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier });
  }

  function withRules(mark, what) {
    const result = structuredClone(liveExample.result);
    const step = result.summary.steps.find((item) => item.id === 'rules');
    step.mark = mark;
    step.what = what;
    return result;
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
          const m = s.match(/DevTools listening on ws:[/][/][^:]+:([0-9]+)/);
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
      const count = await evaluate(`document.querySelectorAll('#verify a[href*="sigstore"], #verify a[href*="solana"]').length`);
      assert.equal(count, 1, `${pagePath} should have exactly 1 sigstore/solana link`);
      const href = await evaluate(`document.querySelector('#verify a[href*="sigstore"], #verify a[href*="solana"]').href`);
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
    const query = '?repo=expressjs/express';
    await openFakeCheck(query, [['result', liveExample.result], ['fixes', liveExample.fixes]]);
    assert.equal(await evaluate(`document.querySelectorAll('details[name="steps"]').length`), 4);
    const openIds = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('details[name="steps"][open]')].map(e=>e.id))`) || '[]');
    assert.deepEqual(openIds, ['step-copy']);
    await evaluate(`document.querySelector("#step-paste summary").click()`);
    await new Promise((r) => setTimeout(r, 100));
    const openIds2 = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('details[name="steps"][open]')].map(e=>e.id))`) || '[]');
    assert.deepEqual(openIds2, ['step-paste']);
  });

  test('only a long file row has a read fold, and it copies before it opens', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const bigFile = { path: '.github/big.md', content: 'x'.repeat(7000), source: 'yokoten' };
    const extraScript = `window.__calls = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__calls.push(['copy', text]); } } });
window.open = (url) => { window.__calls.push(['open', url]); return null; };`;
    await openFakeCheck('?repo=expressjs/express', [['result', liveExample.result], ['fixes', { ...liveExample.fixes, files: [...liveExample.fixes.files, bigFile] }]], extraScript);
    const rows = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-file-list] .file')].map((row) => ({ isLong: row.querySelector('[data-add]').textContent.includes('Copy and open'), hasFold: row.querySelector('.file-read details') !== null })))`));
    assert.ok(rows.length > 1, 'the page lists files');
    assert.equal(rows.filter((row) => row.isLong).length, 1);
    for (const row of rows) assert.equal(row.hasFold, row.isLong);
    await evaluate(`[...document.querySelectorAll('[data-file-list] [data-add]')].find((link) => link.textContent.includes('Copy and open')).click()`);
    await new Promise((r) => setTimeout(r, 200));
    const calls = JSON.parse(await evaluate(`JSON.stringify(window.__calls)`));
    assert.deepEqual(calls.map((call) => call[0]), ['copy', 'open']);
    assert.equal(calls[0][1], bigFile.content);
    assert.equal(calls[1][1].includes('value='), false);
  });

  test('marking a step done opens the next step, and the last step checks that it saved', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    await openFakeCheck(query, [['result', liveExample.result], ['fixes', liveExample.fixes]]);
    const h1Start = await evaluate(`document.querySelector(".f-main h1").textContent.trim()`);
    assert.equal(h1Start, "Here's what an AI understood.");
    const steps = ['step-copy', 'step-paste', 'step-save'];
    const nextOpen = ['step-paste', 'step-save', 'step-check'];
    for (let i = 0; i < 3; i++) {
      await evaluate(`document.querySelector(".f-step[open] [data-done]").click()`);
      await new Promise((r) => setTimeout(r, 100));
      const isDone = await evaluate(`document.getElementById("${steps[i]}").classList.contains("is-done")`);
      assert.equal(isDone, true);
      const openIds = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('details[name="steps"][open]')].map(e=>e.id))`) || '[]');
      assert.deepEqual(openIds, [nextOpen[i]]);
    }
    const lastHasDone = await evaluate(`document.querySelector(".f-step[open] [data-done]") !== null`);
    assert.equal(lastHasDone, false);
    const href = await evaluate(`document.querySelector(".f-step[open] .save-actions a").href`);
    assert.ok(href.endsWith('saved=1'), `href should end with saved=1, got ${href}`);
    const h1End = await evaluate(`document.querySelector(".f-main h1").textContent.trim()`);
    assert.equal(h1End, "Here's what an AI understood.");
  });

  test('no page shows a count of checks', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const checkPages = ['/', '/about.html'];
    if (fs.existsSync(examplesDir)) {
      for (const f of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
        checkPages.push(`/example/${path.basename(f, '.json')}.html`);
      }
    }
    for (const pagePath of checkPages) {
      await navigate(pagePath, 1440);
      const text = await evaluate('document.body.innerText');
      assert.equal(/[0-9]+ of [0-9]+/.test(text), false, `${pagePath} should not contain count`);
      assert.equal(text.includes('checks pass'), false, `${pagePath} should not contain checks pass`);
      const count = await evaluate('document.querySelectorAll(".bar, .ex-count").length');
      assert.equal(count, 0, `${pagePath} should have no .bar or .ex-count`);
    }
  });

  test('the route a visitor walks: the first example in each list shows what the AI understood, all four steps, and a way to reach each result and a preview of each result', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/', 1440);
    const firsts = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.results-group')].map((group) => group.querySelector('a.ex').getAttribute('href')))`));
    assert.equal(firsts.length, 2);
    for (const href of firsts) {
      await navigate(href, 1440);
      assert.equal(await evaluate(`document.querySelector('.f-main h1').textContent.trim()`), "Here's what an AI understood.", href);
      assert.equal(await evaluate(`document.querySelectorAll('.f-know > div').length`), 3, href);
      assert.equal(await evaluate(`document.querySelectorAll('details[name="steps"]').length`), 4, href);
      for (let i = 0; i < 3; i++) {
        await evaluate(`document.querySelector('.f-step[open] [data-done]').click()`);
        await new Promise((r) => setTimeout(r, 100));
      }
      const previews = JSON.parse(await evaluate(`(() => { document.querySelectorAll('.f-step[open] .save-part details').forEach((fold) => { fold.open = true; }); return JSON.stringify([...document.querySelectorAll('.f-step[open] .save-preview-title')].map((title) => title.textContent)); })()`));
      assert.deepEqual(previews, ['Saved. AGENTS.md is in your project.', "We don't see AGENTS.md yet."], href);
    }
  });

  test('an example shows the steps, but nothing on it can copy or save', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/expressjs-express.html', 1440);
    assert.equal(await evaluate(`document.querySelectorAll('details[name="steps"]').length`), 4);
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), "Here's what an AI understood.");
    assert.equal(await evaluate(`document.querySelectorAll(".f-know > div").length`), 3);
    assert.equal(await evaluate(`document.querySelector(".save-head h2").textContent.trim()`), "This is someone else's project.");
    assert.ok((await evaluate(`document.querySelector(".save-head a").href`)).endsWith('/'), 'link href should end with /');
    assert.equal(await evaluate(`document.querySelector(".f-step[open] .btn-primary").disabled`), true);
    assert.equal(await evaluate(`document.querySelector('[data-step="check"] .btn-primary').disabled`), true);
    assert.equal(await evaluate(`document.querySelectorAll('[data-step="check"] .save-part a').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('[data-step="check"] .save-part details').length`), 2);
    assert.equal(await evaluate(`document.querySelectorAll('.f-step a[href*="github.com"]').length`), 0);
    await navigate('/example/cline-cline.html', 1440);
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), 'This project already has an AGENTS.md.');
    assert.equal(await evaluate(`document.querySelector(".f-job.f-single h2").textContent.trim()`), "This is someone else's project.");
    assert.ok((await evaluate(`document.querySelector(".f-job.f-single a").href`)).endsWith('/'), 'link href should end with /');
  });

  test('Read the whole file shows and hides the file', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/expressjs-express.html', 1440);
    assert.equal(await evaluate(`document.querySelector(".save-file .file-text").hidden`), true);
    await evaluate(`document.querySelector(".save-file-name button").click()`);
    assert.equal(await evaluate(`document.querySelector(".save-file .file-text").hidden`), false);
    await evaluate(`document.querySelector(".save-file-name button").click()`);
    assert.equal(await evaluate(`document.querySelector(".save-file .file-text").hidden`), true);
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
      assert.equal(h2, 'More details', `${pagePath} .f-rest > h2 should be More details, got ${h2}`);
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

  test('checking after saving: found', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    await openFakeCheck(query + '&saved=1', [['result', withRules('done', '')], ['fixes', { files: [], summary: '', muse: 'not needed', claude_import: null }]]);
    assert.equal(await evaluate('document.querySelector(".f-main h1").textContent.trim()'), 'Saved. AGENTS.md is in your project.');
    const href = await evaluate('[...document.querySelectorAll("a")].find(a=>a.textContent.trim()==="See it on GitHub").href');
    const branch = liveExample.result.default_branch || 'main';
    assert.ok(href.endsWith(`/blob/${branch}/AGENTS.md`), `href should end with /blob/${branch}/AGENTS.md, got ${href}`);
    const cmd = await evaluate(`document.querySelector('#app .cmd code').textContent`);
    assert.ok(cmd.includes('What should you not touch in this project?'), `cmd should hold question, got ${cmd}`);
    const search = await evaluate('location.search');
    assert.ok(search.includes('saved=1'), `location.search should hold saved=1, got ${search}`);
  });

  test('checking after saving: CLAUDE.md needs one more line', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    await openFakeCheck(query + '&saved=1', [['result', withRules('next', 'CLAUDE.md does not import AGENTS.md')], ['fixes', { files: [], summary: '', muse: 'not needed', claude_import: null }]]);
    assert.equal(await evaluate('document.querySelector(".f-main h1").textContent.trim()'), 'Saved. One more line for Claude Code.');
    assert.equal(await evaluate(`document.querySelector('#app .cmd code').textContent.trim()`), '@AGENTS.md');
    assert.ok((await evaluate(`document.querySelector('.save-actions a').href`)).includes('/edit/'), 'href should hold /edit/');
    await openFakeCheck(query + '&saved=1', [['result', withRules('next', '.claude/CLAUDE.md does not import AGENTS.md')], ['fixes', { files: [], summary: '', muse: 'not needed', claude_import: null }]]);
    assert.equal(await evaluate('document.querySelector(".f-main h1").textContent.trim()'), 'Saved. One more line for Claude Code.');
    assert.equal(await evaluate(`document.querySelector('#app .cmd code').textContent.trim()`), '@../AGENTS.md');
    assert.ok((await evaluate(`document.querySelector('.save-actions a').href`)).includes('/edit/'), 'href should hold /edit/');
    await openFakeCheck(query, [['result', withRules('next', 'CLAUDE.md does not import AGENTS.md')], ['fixes', { files: [], summary: '', muse: 'not needed', claude_import: null }]]);
    assert.equal(await evaluate('document.querySelector(".f-main h1").textContent.trim()'), 'One more line for Claude Code.');
  });

  test('checking after saving: not found, and back to the steps', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    await openFakeCheck(query + '&saved=1', [['result', liveExample.result], ['fixes', liveExample.fixes]]);
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), "We don't see AGENTS.md yet.");
    await evaluate(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Back to the steps").click()`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), "Here's what an AI understood.");
    assert.equal(await evaluate(`document.querySelectorAll('details[name="steps"]').length`), 4);
    const search = await evaluate('location.search');
    assert.equal(search.includes('saved'), false, `location.search should not hold saved, got ${search}`);
  });

  test('a template when the AI failed or the repo is too big', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    const agFile = liveExample.fixes.files.find((f) => f.path === 'AGENTS.md');
    const files = agFile ? [agFile] : [];
    await openFakeCheck(query, [['result', withRules('next', '')], ['fixes', { files, summary: '', muse: 'failed', claude_import: null }]]);
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), "The AI couldn't read this project this time.");
    assert.equal(await evaluate(`document.querySelector('section[aria-label="Save it to your project"]').hidden`), true);
    await evaluate(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add the template instead").click()`);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await evaluate(`document.querySelector('section[aria-label="Save it to your project"] h2').textContent.trim()`), 'Add the template to your project.');
    await openFakeCheck(query, [['result', withRules('next', '')], ['fixes', { files, summary: '', muse: 'not needed', claude_import: null }]]);
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), 'This project is too big for the AI to read here.');
    assert.ok((await evaluate(`[...document.querySelectorAll("button")].map(b=>b.textContent.trim()).join("|")`)).includes('Add the template'), 'button should be Add the template');
    await openFakeCheck(query, [['result', liveExample.result]]);
    assert.equal(await evaluate(`document.querySelector(".f-main h1").textContent.trim()`), "The AI couldn't read this project this time.");
    assert.equal(await evaluate(`document.querySelector('section[aria-label="Save it to your project"]')`), null);
  });

  test('copy and open: the file is copied first, and GitHub opens with no text in the link', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    const extraScript = `window.__calls = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__calls.push(['copy', text]); } } });
window.open = (url) => { window.__calls.push(['open', url]); return null; };`;
    await openFakeCheck(query, [['result', liveExample.result], ['fixes', liveExample.fixes]], extraScript);
    await evaluate('document.querySelector(".f-step[open] .btn-primary").click()');
    await new Promise((r) => setTimeout(r, 200));
    const calls = JSON.parse(await evaluate('JSON.stringify(window.__calls)'));
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'copy');
    const agContent = liveExample.fixes.files.find((f) => f.path === 'AGENTS.md').content;
    assert.ok(calls[0][1].startsWith('# How to work on this project'), 'the file starts with its title');
    assert.equal(calls[0][1].includes('Tool guard'), false, 'the file holds none of yokoten\'s template');
    assert.ok(calls[0][1].includes(agContent.split('### Test')[1].trim().split('\n')[0]), 'the file holds what the AI wrote');
    assert.equal(calls[1][0], 'open');
    assert.ok(calls[1][1].includes('/new/'), `open url should hold /new/, got ${calls[1][1]}`);
    assert.ok(calls[1][1].includes('filename=AGENTS.md'), `open url should hold filename=AGENTS.md, got ${calls[1][1]}`);
    assert.equal(calls[1][1].includes('value='), false, `open url should not hold value=, got ${calls[1][1]}`);
    const status = await evaluate(`document.querySelector('.f-step[open] [role="status"]').textContent.trim()`);
    assert.equal(status, 'Copied. Now go to the GitHub tab.');
  });

  test('copy and open: when copying fails, the file opens on the page and GitHub still opens', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    const extraScript = `window.__calls = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('no'); } } });
window.open = (url) => { window.__calls.push(['open', url]); return null; };`;
    await openFakeCheck(query, [['result', liveExample.result], ['fixes', liveExample.fixes]], extraScript);
    await evaluate('document.querySelector(".f-step[open] .btn-primary").click()');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await evaluate(`document.querySelector(".save-file .file-text").hidden`), false);
    assert.ok((await evaluate(`document.querySelector('.f-step[open] [role="status"]').textContent`)).includes("We couldn't copy it."), 'status should hold the copy failure');
    const calls = JSON.parse(await evaluate('JSON.stringify(window.__calls)'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'open');
  });

  test('an example offers no way to add files to someone else\'s project', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/expressjs-express.html', 1440);
    assert.ok(await evaluate(`document.querySelectorAll('[data-file-list] .file').length`) > 0);
    assert.equal(await evaluate(`document.querySelectorAll('[data-add]').length`), 0);
    assert.equal(await evaluate(`[...document.querySelectorAll('.f-rest summary')].some((row) => row.textContent.includes('Prefer the terminal'))`), false);
  });

  test('when yokoten init fails on the server, the page never claims a CLAUDE.md', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const noAgents = withRules('next', 'no AGENTS.md, so the agents have no written rules here');
    const empty = { files: [], summary: '', muse: 'not needed', claude_import: null };
    await openFakeCheck('?repo=expressjs/express', [['result', noAgents], ['fixes', empty]]);
    assert.equal(await evaluate(`document.querySelector('.f-main h1').textContent.trim()`), "We couldn't get a file ready for this project.");
    assert.equal((await evaluate(`document.body.innerText`)).includes('CLAUDE.md'), false);
    await openFakeCheck('?repo=expressjs/express&saved=1', [['result', noAgents], ['fixes', empty]]);
    assert.equal(await evaluate(`document.querySelector('.f-main h1').textContent.trim()`), "We don't see AGENTS.md yet.");
  });

  test('a repo with AGENTS.md is never said to be read by an AI', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await openFakeCheck('?repo=expressjs/express', [['result', withRules('done', '')]]);
    assert.equal(await evaluate(`document.querySelector('.f-main h1').textContent.trim()`), 'This project already has an AGENTS.md.');
  });

  test('the copy message survives the page drawing itself again', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const extraScript = `Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
window.open = () => null;`;
    await openFakeCheck('?repo=expressjs/express', [['result', liveExample.result], ['fixes', liveExample.fixes]], extraScript, [['record', liveExample.record]]);
    await evaluate(`document.querySelector('.f-step[open] .btn-primary').click()`);
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(await evaluate(`document.querySelector('.f-step[open] [role="status"]').textContent.trim()`), 'Copied. Now go to the GitHub tab.');
  });

  test('Copy link leaves out the saved flag', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const extraScript = `window.__copied = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } } });`;
    await openFakeCheck('?repo=expressjs/express&saved=1', [['result', liveExample.result], ['fixes', liveExample.fixes]], extraScript);
    await evaluate(`document.querySelector('[data-copy-url]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const copied = JSON.parse(await evaluate(`JSON.stringify(window.__copied)`));
    assert.equal(copied.length, 1);
    assert.equal(copied[0].includes('saved'), false);
    assert.ok(copied[0].includes('repo='));
  });

  test('Read the whole file shows only what gets saved', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    await navigate('/example/expressjs-express.html', 1440);
    const text = await evaluate(`document.querySelector('.save-file .file-text').textContent`);
    assert.ok(text.startsWith('# How to work on this project'));
    assert.equal(text.includes('Tool guard'), false);
    assert.equal(text.includes('yokoten doctor'), false);
  });

  test('a CLAUDE.md that is a link shows yokoten\'s own fix, and no edit link', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const result = withRules('next', 'CLAUDE.md does not import AGENTS.md, so Claude Code does not read the rules');
    result.summary.steps.find((step) => step.id === 'rules').fix = 'CLAUDE.md is a link to docs/rules.md: add a line `@AGENTS.md` to that file, or make CLAUDE.md a plain file';
    await openFakeCheck('?repo=expressjs/express', [['result', result], ['fixes', { files: [], summary: '', muse: 'not needed', claude_import: null }]]);
    assert.ok((await evaluate(`document.querySelector('.f-lede').textContent`)).includes('is a link to docs/rules.md'));
    assert.equal(await evaluate(`document.querySelectorAll('a[href*="/edit/"]').length`), 0);
  });

  test('the file name in the picture and the green button fit at phone width', { timeout: 180000 }, async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const query = '?repo=expressjs/express';
    await openFakeCheck(query, [['result', liveExample.result], ['fixes', liveExample.fixes]]);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('document.querySelector(".f-step[open] [data-done]").click()');
    await new Promise((r) => setTimeout(r, 100));
    await evaluate('document.querySelector(".f-step[open] [data-done]").click()');
    await new Promise((r) => setTimeout(r, 100));
    const ok = await evaluate('(() => { const shot = document.querySelector(".save-shot").getBoundingClientRect(); const btn = document.querySelector(".gh-top .gh-green").getBoundingClientRect(); return btn.right <= shot.right + 1; })()');
    assert.ok(ok, 'green button should fit inside save-shot');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  });
});
