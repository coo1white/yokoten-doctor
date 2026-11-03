import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const indexPath = path.join(distDir, 'index.html');
const stylesDir = path.resolve('web/src/styles');

function readAllStyles() {
  return fs.readdirSync(stylesDir).map((name) => fs.readFileSync(path.join(stylesDir, name), 'utf8')).join('\n');
}

function findMissingClasses(classLists, cssText) {
  const defined = new Set();
  const re = /\.([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) defined.add(m[1]);
  const missing = [];
  for (const list of classLists) {
    for (const name of list.split(/\s+/).filter(Boolean)) {
      if (!defined.has(name)) missing.push(name);
    }
  }
  return missing;
}

describe('static host portability', () => {
  test('web/src/data/sample-result.json has a 40-character commit, total equal to the number of steps, and done equal to the steps marked done', () => {
    const p = path.resolve('web/src/data/sample-result.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(typeof data.commit, 'string');
    assert.equal(data.commit.length, 40);
    assert.ok(/^[0-9a-f]{40}$/i.test(data.commit), 'commit should be hex');
    const steps = data.steps;
    assert.ok(Array.isArray(steps), 'steps should be array');
    assert.equal(data.total, steps.length);
    const doneCount = steps.filter(s => s.mark === 'done').length;
    assert.equal(data.done, doneCount);
    assert.ok(Array.isArray(data.examples), 'examples should be array');
    assert.ok(data.examples.length >= 3, 'examples should have at least 3 rows');
    for (const ex of data.examples) {
      assert.equal(typeof ex.repo, 'string', 'example repo should be string');
      assert.ok(ex.repo.length > 0, 'example repo should be non-empty');
      assert.equal(typeof ex.commit, 'string', 'example commit should be string');
      assert.equal(ex.commit.length, 7, `example commit should be 7 characters: ${ex.commit}`);
      assert.ok(/^[0-9a-f]{7}$/i.test(ex.commit), `example commit should be hex: ${ex.commit}`);
      assert.equal(typeof ex.done, 'number', 'example done should be number');
      assert.ok(Number.isInteger(ex.done), 'example done should be integer');
      assert.equal(typeof ex.total, 'number', 'example total should be number');
      assert.ok(Number.isInteger(ex.total), 'example total should be integer');
      assert.ok(ex.after === null || (typeof ex.after === 'number' && Number.isInteger(ex.after)), 'example after should be null or integer');
      assert.ok(['web2', 'web3'].includes(ex.group), `example group should be web2 or web3: ${ex.group}`);
    }
    assert.equal(typeof data.examplesCheckedOn, 'string', 'examplesCheckedOn should be string');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(data.examplesCheckedOn), `examplesCheckedOn should be YYYY-MM-DD: ${data.examplesCheckedOn}`);
  });

  test('every class used in .astro and client .ts appears in the styles', () => {
    const cssText = readAllStyles();
    function walk(dir, exts) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) files = files.concat(walk(full, exts));
        else if (exts.includes(path.extname(e.name))) files.push(full);
      }
      return files;
    }
    const astroFiles = walk(path.resolve('web/src'), ['.astro']);
    const classLists = [];
    for (const file of astroFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const re = /class="([^"]+)"/g;
      let m;
      while ((m = re.exec(content)) !== null) classLists.push(m[1]);
    }
    const tsDir = path.resolve('web/src/client');
    if (fs.existsSync(tsDir)) {
      const tsFiles = walk(tsDir, ['.ts']);
      for (const file of tsFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const re = /className\s*=\s*"([^"]+)"/g;
        let m;
        while ((m = re.exec(content)) !== null) classLists.push(m[1]);
        const re2 = /\b(?:make|createRich)\(\s*"[a-z0-9]+",\s*"([^"]+)"/g;
        let m2;
        while ((m2 = re2.exec(content)) !== null) classLists.push(m2[1]);
        const re3 = /\bclassName:\s*"([^"]+)"/g;
        let m3;
        while ((m3 = re3.exec(content)) !== null) classLists.push(m3[1]);
        const re4 = /\bcreateCopyButton\([^,]+,\s*"([^"]+)"/g;
        let m4;
        while ((m4 = re4.exec(content)) !== null) classLists.push(m4[1]);
      }
    }
    const missing = findMissingClasses(classLists, cssText);
    assert.deepEqual(missing, [], `missing classes in the styles: ${missing.join(', ')}`);
  });

  test('findMissingClasses helper catches missing names', () => {
    const css = '.foo { } .bar { }';
    const missing = findMissingClasses(['foo bar baz', 'qux'], css);
    assert.deepEqual(missing.sort(), ['baz', 'qux']);
    const none = findMissingClasses(['foo bar'], css);
    assert.deepEqual(none, []);
  });

  test('the styles do not hide every nav, so the footer links stay on a phone', () => {
    assert.doesNotMatch(readAllStyles(), /(^|[\s{}])nav\s*\{\s*display:\s*none/);
  });

  test('web/src/styles/global.css holds only @import lines, and every imported file exists', () => {
    const lines = fs.readFileSync(path.join(stylesDir, 'global.css'), 'utf8').trim().split('\n');
    assert.ok(lines.length > 0);
    for (const line of lines) {
      const match = line.match(/^@import "\.\/([a-z]+\.css)";$/);
      assert.ok(match, `global.css should hold only @import lines, found: ${line}`);
      assert.ok(fs.existsSync(path.join(stylesDir, match[1])), `${match[1]} should exist`);
    }
  });

  test('the visible text of the home, about and agent pages holds none of the banned words', () => {
    const banned = ['ready for ai agents', 'score', 'security scan', 'find leaks', 'keeps nothing', 'every line by muse', 'proven', 'weaker model'];
    for (const name of ['index.html', 'about.html', 'agent-view.html']) {
      const html = fs.readFileSync(path.join(path.dirname(indexPath), name), 'utf8');
      const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ').toLowerCase();
      for (const word of banned) assert.equal(text.includes(word), false, `dist/${name} should not contain "${word}"`);
    }
  });

  test('example pages exist and contain noindex', () => {
    const sample = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of sample.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const htmlPath = path.join(distDir, 'example', `${slug}.html`);
      assert.ok(fs.existsSync(htmlPath), `missing ${htmlPath}`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.ok(html.includes('name="robots"') && html.includes('content="noindex"'), `${slug}.html should contain robots noindex`);
      assert.ok(html.includes('<noscript>'), `${slug}.html should explain that it needs JavaScript`);
    }
  });

  test('example saved data matches sample summary and after/files', () => {
    const sample = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of sample.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const saved = JSON.parse(fs.readFileSync(path.resolve(`web/src/data/examples/${slug}.json`), 'utf8'));
      assert.ok(String(saved.result.commit).startsWith(ex.commit), `${slug} result.commit should start with ${ex.commit}`);
      assert.equal(saved.result.summary.done, ex.done, `${slug} summary.done`);
      assert.equal(saved.result.summary.total, ex.total, `${slug} summary.total`);
      if (ex.after === null) {
        assert.ok(saved.fixes.after == null, `${slug} fixes.after should be null or missing when ex.after is null`);
      } else {
        assert.equal(saved.fixes.after.done, ex.after, `${slug} fixes.after.done`);
      }
      assert.equal(saved.fixes.files.length, ex.files, `${slug} fixes.files.length`);
    }
  });

  test('example fixes.muse finished', () => {
    const sample = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of sample.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const saved = JSON.parse(fs.readFileSync(path.resolve(`web/src/data/examples/${slug}.json`), 'utf8'));
      assert.ok(saved.fixes.muse === "ok" || saved.fixes.muse === "not needed", `${slug} fixes.muse should be ok or not needed`);
      if (saved.fixes.muse === "not needed") {
        const rules = saved.result.summary.steps.find((step) => step.id === "rules");
        assert.equal(rules.mark, "done", `${slug} says Muse was not needed, so it must have its own rules file`);
      }
    }
  });

  test('saved-check block has no < and parses to saved file', () => {
    const sample = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of sample.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const htmlPath = path.join(distDir, 'example', `${slug}.html`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      const m = html.match(/<div id="saved-check" data-check="([^"]*)"/);
      assert.ok(m, `saved-check not found in ${slug}.html`);
      const inner = m[1].replaceAll('&#34;', '"').replaceAll('&quot;', '"').replaceAll('&#38;', '&').replaceAll('&amp;', '&');
      assert.equal(inner.includes("<"), false, `saved-check in ${slug}.html should not contain <`);
      const parsed = JSON.parse(inner);
      const saved = JSON.parse(fs.readFileSync(path.resolve(`web/src/data/examples/${slug}.json`), 'utf8'));
      assert.deepEqual(parsed, saved, `saved-check data should equal file for ${slug}`);
    }
  });

  test('example pages have src on every script', () => {
    const sample = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of sample.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const htmlPath = path.join(distDir, 'example', `${slug}.html`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      const re = /<script\b([^>]*)>/gi;
      let match;
      while ((match = re.exec(html)) !== null) {
        const attrs = match[1];
        assert.ok(/\bsrc\s*=/.test(attrs), `script without src in ${slug}.html: <script${attrs}>`);
      }
    }
  });

  test('sample-result.json has at least three examples in web2 and at least three in web3, and within each of these two groups the highest done is at least 3 more than the lowest', () => {
    const data = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const group of ['web2', 'web3']) {
      const groupEx = data.examples.filter((ex) => ex.group === group);
      assert.equal(groupEx.length, 4, `${group} should have four examples`);
      const dones = groupEx.map((ex) => ex.done);
      const max = Math.max(...dones);
      const min = Math.min(...dones);
      assert.ok(max - min >= 3, `in ${group} highest done (${max}) should be at least 3 more than lowest (${min})`);
      const isWritten = groupEx.map((ex) => JSON.parse(fs.readFileSync(path.resolve(`web/src/data/examples/${ex.repo.replaceAll('/', '-')}.json`), 'utf8')).fixes.muse === 'ok');
      assert.deepEqual(isWritten, [...isWritten].sort((a, b) => Number(b) - Number(a)), `${group} should list first the examples the AI wrote for`);
    }
  });

  test('dist/index.html holds the titles Web2 and Web3, and says this isn\'t a grade', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.ok(html.includes('Web2'), 'dist/index.html should contain Web2');
    assert.ok(html.includes('Web3'), 'dist/index.html should contain Web3');
    assert.equal(html.includes('Our own repo'), false, 'dist/index.html should not list our own repo');
    assert.ok(html.includes('none of this grades a repo'), 'dist/index.html should contain none of this grades a repo');
  });

  test('dist/index.html holds canonical, og:url, og:image and twitter card', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.ok(html.includes('rel="canonical"'), 'canonical link not found');
    assert.ok(html.includes('href="https://doctor.yokoten.app/"'), 'canonical href should be https://doctor.yokoten.app/');
    assert.ok(html.includes('property="og:url"'), 'og:url not found');
    assert.ok(html.includes('content="https://doctor.yokoten.app/"'), 'og:url content should be https://doctor.yokoten.app/');
    assert.ok(html.includes('property="og:image"'), 'og:image not found');
    assert.ok(html.includes('content="https://doctor.yokoten.app/images/share.png"'), 'og:image should be https://doctor.yokoten.app/images/share.png');
    assert.ok(html.includes('name="twitter:card"'), 'twitter:card not found');
    assert.ok(html.includes('content="summary_large_image"'), 'twitter:card should be summary_large_image');
  });

  test('dist/images/share.png exists and has width 1200 and height 630', () => {
    const pngPath = path.join(distDir, 'images', 'share.png');
    assert.ok(fs.existsSync(pngPath), 'dist/images/share.png should exist');
    const buf = fs.readFileSync(pngPath);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width, 1200, `width should be 1200, got ${width}`);
    assert.equal(height, 630, `height should be 630, got ${height}`);
  });

  test('dist/robots.txt names sitemap and dist/sitemap.xml holds home and not example', () => {
    const robots = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf8');
    assert.ok(robots.includes('Sitemap: https://doctor.yokoten.app/sitemap.xml'), 'robots.txt should contain Sitemap: https://doctor.yokoten.app/sitemap.xml');
    const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes('https://doctor.yokoten.app/'), 'sitemap.xml should contain https://doctor.yokoten.app/');
    assert.equal(sitemap.includes('/example/'), false, 'sitemap.xml should not contain /example/');
  });

  test('example pages have canonical and title prefix', () => {
    const sample = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of sample.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const htmlPath = path.join(distDir, 'example', `${slug}.html`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      const expectedCanonical = `https://doctor.yokoten.app/example/${slug}.html`;
      assert.ok(html.includes(expectedCanonical), `${slug}.html should contain canonical ${expectedCanonical}`);
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      assert.ok(titleMatch, `title not found in ${slug}.html`);
      const title = titleMatch[1];
      const expectedStart = `${ex.repo}: a saved result`;
      assert.ok(title.startsWith(expectedStart), `title in ${slug}.html should start with "${expectedStart}", got "${title}"`);
    }
  });
});

describe('node version pin', () => {
  test('every node-version in workflows matches engines.node and has three parts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const expected = pkg.engines.node.replace(/^>=/, '');
    assert.match(expected, /^\d+\.\d+\.\d+$/);
    const workflowFiles = ['.github/workflows/test.yml', '.github/workflows/pages.yml'];
    for (const rel of workflowFiles) {
      const content = fs.readFileSync(path.resolve(rel), 'utf8');
      const re = /node-version:\s*["']?([^"'\s]+)["']?/g;
      let m;
      let count = 0;
      while ((m = re.exec(content)) !== null) {
        count++;
        const v = m[1];
        assert.match(v, /^\d+\.\d+\.\d+$/, `${rel} node-version should have three number parts: ${v}`);
        assert.equal(v, expected, `${rel} node-version ${v} should equal engines.node without >= (${expected})`);
      }
      assert.ok(count > 0, `${rel} should contain node-version`);
    }
  });
});
