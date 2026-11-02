import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const indexPath = path.join(distDir, 'index.html');
const appPath = path.join(path.resolve('web/src/client'), 'app.ts');
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
  test('every <link> and <script> in dist/index.html has a path starting with /_astro/ or equal to /favicon.svg, and no scheme', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const tagRe = /<(?:link|script)\b[^>]*>/gi;
    let tagMatch;
    const values = [];
    while ((tagMatch = tagRe.exec(html)) !== null) {
      const tag = tagMatch[0];
      // A canonical address names the site by design, and it loads nothing.
      if (/^<link rel="canonical" href="https:\/\/doctor\.yokoten\.app\/[^"]*"\s*\/?>$/.test(tag)) continue;
      const attrMatch = tag.match(/\b(?:href|src)\s*=\s*["']([^"']+)["']/i);
      if (attrMatch) values.push(attrMatch[1]);
    }
    assert.ok(values.length > 0, 'expected at least one href or src');
    for (const v of values) {
      assert.equal(/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(v), false, `href/src should not have a scheme: ${v}`);
      const ok = v === '/favicon.svg' || v === '/images/favicon.svg' || v === '/js/theme.js' || v.startsWith('/_astro/');
      assert.ok(ok, `href/src should be /favicon.svg or /images/favicon.svg or /js/theme.js or start with /_astro/: ${v}`);
    }
  });

  test('dist/ holds only .html, .js, .css, .svg, .woff2, .png, .txt and .xml', () => {
    const allowed = new Set(['.html', '.js', '.css', '.svg', '.woff2', '.png', '.txt', '.xml']);
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          assert.ok(allowed.has(ext), `unexpected file in dist/: ${path.relative(distDir, full)} (extension ${ext})`);
        }
      }
    }
    walk(distDir);
  });

  test('every SVG in dist/ holds no <script and no on...= attribute', () => {
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const svgs = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) svgs.push(...walk(full));
        else if (e.isFile() && path.extname(e.name).toLowerCase() === '.svg') svgs.push(full);
      }
      return svgs;
    }
    const svgFiles = walk(distDir);
    for (const file of svgFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lower = content.toLowerCase();
      assert.equal(lower.includes('<script'), false, `SVG should not contain <script: ${path.relative(distDir, file)}`);
      assert.equal(/\bon\w+\s*=/i.test(content), false, `SVG should not contain on...= attribute: ${path.relative(distDir, file)}`);
    }
  });

  test('dist/index.html has a description meta tag, og:title, and a relative icon link', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const descRe = /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*>/i;
    const descMatch = html.match(descRe);
    assert.ok(descMatch, 'description meta tag not found');
    const descTag = descMatch[0];
    const descContent = descTag.match(/content\s*=\s*["']([^"']+)["']/i);
    assert.ok(descContent && descContent[1].trim().length > 0, 'description meta tag should have non-empty content');
    const ogRe = /<meta\s+[^>]*property\s*=\s*["']og:title["'][^>]*>/i;
    const ogMatch = html.match(ogRe);
    assert.ok(ogMatch, 'og:title meta tag not found');
    const ogTag = ogMatch[0];
    const ogContent = ogTag.match(/content\s*=\s*["']([^"']+)["']/i);
    assert.ok(ogContent && ogContent[1].trim().length > 0, 'og:title meta tag should have non-empty content');
    const linkRe = /<link\s+[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/gi;
    const iconMatches = [...html.matchAll(linkRe)];
    assert.ok(iconMatches.length > 0, 'icon link not found');
    for (const m of iconMatches) {
      const tag = m[0];
      const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      assert.ok(hrefMatch, `icon link should have href: ${tag}`);
      assert.equal(hrefMatch[1], '/images/favicon.svg');
    }
  });

  test('connect-src in meta tag equals API constant in web/src/client/app.ts', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const app = fs.readFileSync(appPath, 'utf8');
    const metaRe = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i;
    const metaMatch = html.match(metaRe);
    assert.ok(metaMatch, 'Content-Security-Policy meta tag not found');
    const metaTag = metaMatch[0];
    const contentMatch = metaTag.match(/content="([^"]+)"/i);
    assert.ok(contentMatch, 'CSP meta tag has no content attribute');
    const csp = contentMatch[1];
    const connectMatch = csp.match(/connect-src\s+([^;]+)/);
    assert.ok(connectMatch, 'connect-src not found in CSP');
    const connectSrc = connectMatch[1].trim().split(/\s+/)[0];
    const apiMatch = app.match(/API\s*=\s*["']([^"']+)["']/);
    assert.ok(apiMatch, 'API constant not found in web/src/client/app.ts');
    const api = apiMatch[1].trim();
    assert.equal(connectSrc, api, `connect-src (${connectSrc}) should equal API (${api})`);
  });

  test('dist/index.html holds the page\'s strings: h1 is "Check your repo before you hand it to an AI agent.", and "Real results", "It doesn\'t scan your code for vulnerabilities" and "devnet"', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const h1Re = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
    const h1Match = html.match(h1Re);
    assert.ok(h1Match, 'h1 not found in dist/index.html');
    const raw = h1Match[1].trim();
    const decoded = raw
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&#x2019;/gi, "'")
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(decoded, "Check your repo before you hand it to an AI agent.");
    assert.ok(html.includes('Real results'), 'dist/index.html should contain "Real results"');
    assert.ok(html.includes("It doesn't scan your code for vulnerabilities"), "dist/index.html should contain \"It doesn't scan your code for vulnerabilities\"");
    assert.ok(html.includes('devnet'), 'dist/index.html should contain "devnet"');
  });

  test('every imported name in web/src/client exists in its source file', () => {
    function walkTs(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...walkTs(full));
        else if (e.isFile() && path.extname(e.name) === '.ts') files.push(full);
      }
      return files;
    }
    const tsFiles = walkTs(path.resolve('web/src/client'));
    const importRe = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      let m;
      while ((m = importRe.exec(content)) !== null) {
        const specifiersRaw = m[1];
        const importPath = m[2];
        const targetPath = path.resolve(path.dirname(file), importPath);
        assert.ok(fs.existsSync(targetPath), `${path.relative(process.cwd(), file)} imports ${importPath} but file does not exist: ${path.relative(process.cwd(), targetPath)}`);
        const targetContent = fs.readFileSync(targetPath, 'utf8');
        const specs = specifiersRaw.split(',');
        for (const raw of specs) {
          const trimmed = raw.trim();
          if (!trimmed) continue;
          const name = trimmed.split(/\s+as\s+/)[0].trim();
          if (!name) continue;
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const exportRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${escaped}\\b|export\\s+const\\s+${escaped}\\b|export\\s+class\\s+${escaped}\\b|export\\s+interface\\s+${escaped}\\b|export\\s+type\\s+${escaped}\\b`);
          assert.ok(exportRe.test(targetContent), `${path.relative(process.cwd(), file)} imports ${name} from ${importPath} but ${path.relative(process.cwd(), targetPath)} does not export it`);
        }
      }
    }
  });

  test('dist/index.html holds the h1 "Check your repo before you hand it to an AI agent.", the label, the Check button, the three examples, and the noscript sentence', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const h1Re = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
    const h1 = html.match(h1Re);
    assert.ok(h1, 'heading not found in dist/index.html');
    const raw = h1[1].trim();
    const decoded = raw
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&#x2019;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(decoded, "Check your repo before you hand it to an AI agent.");
    assert.ok(html.includes('Real results'), 'dist/index.html should contain "Real results"');
    assert.ok(html.includes("It doesn't scan your code for vulnerabilities"), "dist/index.html should contain \"It doesn't scan your code for vulnerabilities\"");
    assert.ok(html.includes('devnet'), 'dist/index.html should contain "devnet"');
    assert.ok(html.includes('<label'), 'label not found in dist/index.html');
    assert.ok(html.includes('>Check<') || html.includes('>Check </button>') || html.includes('Check'), 'Check button not found');
    const buttonRe = /<button[^>]*>([^<]+)<\/button>/i;
    const buttonMatch = html.match(buttonRe);
    assert.ok(buttonMatch, 'Check button not found');
    assert.equal(buttonMatch[1].trim(), 'Check');
    const data = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of data.examples) {
      assert.ok(html.includes(ex.repo), `example "${ex.repo}" not in dist/index.html`);
    }
    assert.ok(html.includes('Running a check needs JavaScript. You can also run it on your machine: npx yokoten'), 'noscript text incorrect');
  });

  test('example links in dist/index.html point to /example/<slug>', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const data = JSON.parse(fs.readFileSync(path.resolve('web/src/data/sample-result.json'), 'utf8'));
    for (const ex of data.examples) {
      const slug = ex.repo.replaceAll("/", "-");
      const href = `/example/${slug}.html`;
      assert.ok(html.includes(`href="${href}"`), `link for repo "${ex.repo}" should be href="${href}"`);
    }
  });

  test('dist/index.html has no <script> without src, no <style>, and no style= attribute, because the policy blocks them', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const scriptRe = /<script\b[^>]*>/gi;
    let sm;
    while ((sm = scriptRe.exec(html)) !== null) {
      const tag = sm[0];
      assert.ok(/\bsrc\s*=/.test(tag), `<script> without src found: ${tag}`);
    }
    assert.equal(html.toLowerCase().includes('<style'), false, 'dist/index.html should not contain <style>');
    assert.equal(/\bstyle\s*=/.test(html), false, 'dist/index.html should not contain style= attribute');
  });

  test('"How this was made" is in dist/about.html, not on dist/index.html, and the page links to About and not to Docs', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const about = fs.readFileSync(path.join(path.dirname(indexPath), 'about.html'), 'utf8');
    const marker = 'How this was made';
    assert.ok(html.includes('<main id="app"'), '<main id="app" not found');
    assert.ok(about.includes(marker), `${marker} not found in dist/about.html`);
    assert.equal(html.includes(marker), false, `${marker} should not be in dist/index.html`);
    assert.ok(html.includes('href="/about.html"'), 'dist/index.html should link to /about.html');
    assert.equal(html.includes('yokoten.app/docs'), false, 'dist/index.html should not link to Docs');
    assert.equal(html.includes('How it works'), false, 'dist/index.html should not link to How it works');
    assert.equal(html.includes('/#questions'), false, 'dist/index.html should not link to Questions');
    assert.equal(html.includes('yokoten.app/about'), false, 'dist/index.html should not link to the yokoten About page');
    assert.ok(html.includes('Real results'), 'dist/index.html should contain "Real results"');
    assert.ok(html.includes("It doesn't scan your code for vulnerabilities"), "dist/index.html should contain \"It doesn't scan your code for vulnerabilities\"");
    assert.ok(html.includes('devnet'), 'dist/index.html should contain "devnet"');
  });

  test('dist/llms.txt and dist/agent-view.html both come from web/src/data/agent-view.md, and the home page links to the agent view', () => {
    const source = fs.readFileSync(path.resolve('web/src/data/agent-view.md'), 'utf8');
    const dist = path.dirname(indexPath);
    assert.equal(fs.readFileSync(path.join(dist, 'llms.txt'), 'utf8'), source);
    const page = fs.readFileSync(path.join(dist, 'agent-view.html'), 'utf8');
    assert.ok(page.includes('<pre>'), 'dist/agent-view.html should show the text in <pre>');
    assert.ok(page.includes('## Rules for agents'), 'dist/agent-view.html should hold the agent view text');
    assert.ok(fs.readFileSync(indexPath, 'utf8').includes('href="/agent-view.html"'), 'dist/index.html should link to the agent view');
  });

  test('the server deploy runs only from main, and only its deploy step reads the Modal token', () => {
    const workflow = fs.readFileSync(path.resolve('.github/workflows/deploy-server.yml'), 'utf8');
    assert.ok(!workflow.includes('pull_request'), 'deploy-server.yml should not run on a pull request');
    assert.match(workflow, /branches: \[main\]/);
    assert.match(workflow, /environment: modal/);
    assert.match(workflow, /needs: test\n    if: github\.ref == 'refs\/heads\/main'/);
    assert.equal(workflow.split('secrets.').length - 1, 2, 'deploy-server.yml should read only the two Modal secrets');
    const beforeDeployStep = workflow.slice(0, workflow.indexOf('- name: Deploy'));
    assert.ok(!beforeDeployStep.includes('secrets.'), 'no step before Deploy should read a secret');
    const afterDeployStep = workflow.slice(workflow.indexOf('- name: Check the live server'));
    assert.ok(!afterDeployStep.includes('secrets.'), 'no step after Deploy should read a secret');
  });

  test('every page has one link to the agent view in its footer, and no floating view switch', () => {
    const dist = path.dirname(indexPath);
    for (const name of ['index.html', 'about.html', 'agent-view.html']) {
      const html = fs.readFileSync(path.join(dist, name), 'utf8');
      assert.equal(html.includes('view-switch'), false, `dist/${name} should have no view switch`);
      const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
      assert.equal(footer.split('<a href="/agent-view.html">For agents</a>').length - 1, 1, `dist/${name} should link to the agent view once in its footer`);
    }
  });

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
      assert.deepEqual(dones, [...dones].sort((a, b) => b - a), `${group} should run from its highest result to its lowest`);
    }
  });

  test('dist/index.html holds the titles Web2 and Web3, and the sentence a repo without it tops out at 8 of 13', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.ok(html.includes('Web2'), 'dist/index.html should contain Web2');
    assert.ok(html.includes('Web3'), 'dist/index.html should contain Web3');
    assert.equal(html.includes('Our own repo'), false, 'dist/index.html should not list our own repo');
    assert.ok(html.includes('a repo without it tops out at 8 of 13'), 'dist/index.html should contain a repo without it tops out at 8 of 13');
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
      const expectedStart = `${ex.repo}: ${ex.done} of ${ex.total} file checks`;
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
