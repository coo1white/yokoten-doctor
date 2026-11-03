import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const stylesDir = path.resolve('web/src/styles');

function walkHtml(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(walkHtml(full));
    else if (e.isFile() && path.extname(e.name) === '.html') files.push(full);
  }
  return files;
}

function readAllDistCss() {
  const astroDir = path.join(distDir, '_astro');
  if (!fs.existsSync(astroDir)) return '';
  const cssFiles = fs.readdirSync(astroDir).filter((f) => f.endsWith('.css'));
  return cssFiles.map((f) => fs.readFileSync(path.join(astroDir, f), 'utf8')).join('\n');
}

const allCss = readAllDistCss();

function readTokens() {
  return fs.readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8');
}

function readOtherStyles() {
  const files = fs.readdirSync(stylesDir).filter((f) => f.endsWith('.css') && f !== 'tokens.css');
  return files.map((f) => fs.readFileSync(path.join(stylesDir, f), 'utf8')).join('\n');
}

describe('built site', () => {
  test('one container: one width token and one rule that uses it', () => {
    const tokenCount = (allCss.match(/--wide:/g) || []).length;
    assert.equal(tokenCount, 1, '--wide: should appear exactly once');
    assert.ok(/--wide:\s*1160px/.test(allCss), '--wide: should be 1160px');
    const useCount = (allCss.match(/var\(--wide\)/g) || []).length;
    assert.equal(useCount, 1, 'var(--wide) should appear exactly once');
    const idx = allCss.indexOf('var(--wide)');
    assert.ok(idx !== -1, 'var(--wide) not found');
    const before = allCss.slice(0, idx);
    const lastOpen = before.lastIndexOf('{');
    const selectorStart = before.lastIndexOf('}', lastOpen) + 1;
    const selector = before.slice(selectorStart, lastOpen).trim();
    assert.match(selector, /^\.wide\s*$/, `selector should be .wide, got "${selector}"`);
  });

  test('one container: every static page\'s header, footer and zones sit in it', () => {
    const htmlFiles = walkHtml(distDir);
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(html.includes('<header class="site-head"><div class="wide top">'), `${path.relative(distDir, file)} should have header container`);
      assert.ok(html.includes('<footer class="foot"><div class="wide foot-in">'), `${path.relative(distDir, file)} should have footer container`);
    }
    for (const name of ['index.html', 'about.html', 'agent-view.html', '404.html']) {
      const html = fs.readFileSync(path.join(distDir, name), 'utf8');
      const re = /<(?:section|div) class="(?:band|zone)"[^>]*>\s*<div class="([^"]*)"/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const classes = m[1].split(/\s+/);
        assert.ok(classes.includes('wide'), `${name} band/zone should include wide: ${m[0]}`);
      }
    }
  });

  test('no page version of the old styles is left', () => {
    for (const s of ['--accent', '--raised', '--shadow', '.panel-head', '.score-bar']) {
      assert.equal(allCss.includes(s), false, `allCss should not contain ${s}`);
    }
    assert.equal(allCss.includes('.bar'), false, 'no css for the old bar');
  });

  test('status has one color each: blue presses, green passes, yellow needs work', () => {
    const tokens = readTokens();
    const others = readOtherStyles();
    assert.ok(tokens.includes('--press: #1a56db'), 'tokens should have --press light');
    assert.ok(tokens.includes('--press: #86adff'), 'tokens should have --press dark');
    assert.ok(tokens.includes('--pass: #0a6b3d'), 'tokens should have --pass light');
    assert.ok(tokens.includes('--pass: #5ad69a'), 'tokens should have --pass dark');
    assert.ok(tokens.includes('--pass-fill: #0f8a50'), 'tokens should have --pass-fill light');
    assert.ok(tokens.includes('--pass-fill: #3fbf83'), 'tokens should have --pass-fill dark');
    assert.ok(tokens.includes('--todo: #7a4e00'), 'tokens should have --todo light');
    assert.ok(tokens.includes('--todo: #f2bb3d'), 'tokens should have --todo dark');
    assert.ok(tokens.includes('--todo-fill: #c08300'), 'tokens should have --todo-fill light');
    assert.ok(tokens.includes('--todo-fill: #e0a526'), 'tokens should have --todo-fill dark');
    const resultCss = fs.readFileSync(path.join(stylesDir, 'result.css'), 'utf8');
    assert.ok(resultCss.includes('.ck-mark { color: var(--todo); }'), 'result.css should have .ck-mark todo');
    assert.ok(resultCss.includes('.ck.is-done .ck-mark { color: var(--pass); }'), 'result.css should have done pass');
    const allStyles = readTokens() + others;
    const badRe = /([^\{]*\.(?:ck|bar|swatch)[^\{]*)\{[^}]*var\(--bad\)/g;
    let badMatch;
    let foundBad = false;
    while ((badMatch = badRe.exec(allStyles)) !== null) foundBad = true;
    assert.equal(foundBad, false, '--bad should not be used with .ck, .bar or .swatch');
  });

  test('the record block shows one link, says nothing about HOME, and never offers a browser check or an agent prompt', () => {
    const proof = fs.readFileSync(path.resolve('web/src/client/ui/proof.ts'), 'utf8');
    assert.equal(proof.includes('HOME'), false, 'proof.ts should not contain HOME');
    assert.equal(proof.includes('Check it in this browser'), false, 'proof.ts should not contain Check it in this browser');
    assert.ok(proof.includes('if (rv.rekorUrl)'), 'proof.ts should have if (rv.rekorUrl)');
    assert.ok(proof.includes('else if (rv.solanaUrl)'), 'proof.ts should have else if (rv.solanaUrl)');
    assert.ok(proof.includes('Solana devnet memo (test network)'), 'proof.ts should mention Solana devnet');
    const uiDir = path.resolve('web/src/client/ui');
    const uiFiles = fs.readdirSync(uiDir).filter((f) => f.endsWith('.ts'));
    for (const f of uiFiles) {
      const txt = fs.readFileSync(path.join(uiDir, f), 'utf8');
      assert.equal(txt.includes('Copy a prompt'), false, `${f} should not contain Copy a prompt`);
      assert.equal(txt.includes('Check it in this browser'), false, `${f} should not contain Check it in this browser`);
    }
  });

  test('nothing shows a "new" tag', () => {
    const uiDir = path.resolve('web/src/client/ui');
    const files = fs.readdirSync(uiDir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const txt = fs.readFileSync(path.join(uiDir, f), 'utf8');
      assert.equal(txt.includes('>new<'), false, `${f} should not contain >new<`);
      assert.equal(txt.includes('"new"'), false, `${f} should not contain "new"`);
    }
  });

  test("the prototype's fake run didn't ship", () => {
    const clientDir = path.resolve('web/src/client');
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let out = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(walk(full));
        else if (e.isFile()) out.push(full);
      }
      return out;
    }
    const clientFiles = walk(clientDir);
    for (const file of clientFiles) {
      const txt = fs.readFileSync(file, 'utf8');
      assert.equal(txt.includes('Prototype:'), false, `${file} should not contain Prototype:`);
      assert.equal(txt.includes('data-run-demo'), false, `${file} should not contain data-run-demo`);
      assert.equal(txt.includes('proto-tag'), false, `${file} should not contain proto-tag`);
    }
    const htmlFiles = walkHtml(distDir);
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, 'utf8');
      assert.equal(html.includes('Prototype:'), false, `${path.relative(distDir, file)} should not contain Prototype:`);
      assert.equal(html.includes('data-run-demo'), false, `${path.relative(distDir, file)} should not contain data-run-demo`);
      assert.equal(html.includes('proto-tag'), false, `${path.relative(distDir, file)} should not contain proto-tag`);
    }
  });

  test('the visible client text holds none of the banned words', () => {
    const banned = ['ready for ai agents', 'security scan', 'find leaks', 'keeps nothing', 'every line by muse', 'proven'];
    const uiDir = path.resolve('web/src/client/ui');
    const files = fs.readdirSync(uiDir).filter((f) => f.endsWith('.ts'));
    files.push(path.resolve('web/src/client/app.ts'));
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const txt = fs.readFileSync(file, 'utf8');
      const re = /"([^"]*)"|`([^`]*)`/g;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const lit = (m[1] ?? m[2] ?? '').toLowerCase();
        for (const b of banned) {
          assert.equal(lit.includes(b), false, `${path.basename(file)} string should not contain "${b}": ${lit}`);
        }
      }
    }
  });

  test('about credits Claude with no model name', () => {
    const html = fs.readFileSync(path.join(distDir, 'about.html'), 'utf8');
    assert.ok(html.includes('<dt>Claude</dt>'), 'about.html should contain <dt>Claude</dt>');
    for (const name of ['Opus', 'Sonnet', 'Haiku', 'Fable']) {
      assert.equal(html.includes(name), false, `about.html should not contain ${name}`);
    }
  });

  test('a page without inline style or script, on every page', () => {
    const htmlFiles = walkHtml(distDir);
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, 'utf8');
      const scriptRe = /<script\b[^>]*>/gi;
      let m;
      while ((m = scriptRe.exec(html)) !== null) {
        assert.ok(/\bsrc\s*=/.test(m[0]), `${path.relative(distDir, file)} <script> should have src: ${m[0]}`);
      }
      assert.equal(html.toLowerCase().includes('<style'), false, `${path.relative(distDir, file)} should not contain <style>`);
      assert.equal(/\bstyle\s*=/.test(html), false, `${path.relative(distDir, file)} should not contain style=`);
    }
  });
});
