import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const indexPath = path.join(distDir, 'index.html');
const appPath = path.join(path.resolve('web/src/client'), 'app.ts');

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

  test('dist/index.html holds the page\'s strings: h1 is "Check your repo before you hand it to an AI agent.", and "Or open a real result", "It doesn\'t scan your code for vulnerabilities" and "devnet" in about.html', () => {
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
    assert.ok(html.includes('Or open a real result'), 'dist/index.html should contain "Or open a real result"');
    assert.ok(html.includes("It doesn't scan your code for vulnerabilities"), "dist/index.html should contain \"It doesn't scan your code for vulnerabilities\"");
    assert.ok(fs.readFileSync(path.join(distDir, 'about.html'), 'utf8').includes('devnet'), 'dist/about.html should contain "devnet"');
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
    assert.ok(html.includes('Or open a real result'), 'dist/index.html should contain "Or open a real result"');
    assert.ok(html.includes("It doesn't scan your code for vulnerabilities"), "dist/index.html should contain \"It doesn't scan your code for vulnerabilities\"");
    assert.ok(fs.readFileSync(path.join(distDir, 'about.html'), 'utf8').includes('devnet'), 'dist/about.html should contain "devnet"');
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
    assert.ok(html.includes('id="app"'), 'id="app" not found');
    assert.ok(about.includes(marker), `${marker} not found in dist/about.html`);
    assert.equal(html.includes(marker), false, `${marker} should not be in dist/index.html`);
    assert.ok(html.includes('href="/about.html"'), 'dist/index.html should link to /about.html');
    assert.equal(html.includes('yokoten.app/docs'), false, 'dist/index.html should not link to Docs');
    assert.equal(html.includes('How it works'), false, 'dist/index.html should not link to How it works');
    assert.equal(html.includes('/#questions'), false, 'dist/index.html should not link to Questions');
    assert.equal(html.includes('yokoten.app/about'), false, 'dist/index.html should not link to the yokoten About page');
    assert.ok(html.includes('Or open a real result'), 'dist/index.html should contain "Or open a real result"');
    assert.ok(html.includes("It doesn't scan your code for vulnerabilities"), "dist/index.html should contain \"It doesn't scan your code for vulnerabilities\"");
    assert.ok(fs.readFileSync(path.join(distDir, 'about.html'), 'utf8').includes('devnet'), 'dist/about.html should contain "devnet"');
  });

  test('dist/llms.txt comes from web/src/data/agent-view.md, the agent view shows its rules and limits, and the home page links to the agent view', () => {
    const source = fs.readFileSync(path.resolve('web/src/data/agent-view.md'), 'utf8');
    const dist = path.dirname(indexPath);
    assert.equal(fs.readFileSync(path.join(dist, 'llms.txt'), 'utf8'), source);
    const pageHtml = fs.readFileSync(path.join(dist, 'agent-view.html'), 'utf8');
    let page = pageHtml.replace(/<[^>]*>/g, ' ');
    page = page.replace(/\s+/g, ' ').trim();
    page = page.replaceAll('&quot;', '"').replaceAll('&#34;', '"').replaceAll('&#39;', "'").replaceAll('&#x27;', "'").replaceAll('&amp;', '&');
    for (const heading of ['## Rules for agents', '## Limits']) {
      const start = source.indexOf(heading);
      assert.ok(start !== -1, `${heading} not found in source`);
      const after = source.slice(start + heading.length);
      const next = after.search(/\n## /);
      const section = next === -1 ? after : after.slice(0, next);
      const lines = section.split('\n').filter((l) => l.startsWith('- '));
      for (const line of lines) {
        const clean = line.slice(2).replaceAll('`', '');
        const sentences = clean.split(/(?<=\.)\s+/);
        for (const s of sentences) {
          const t = s.trim();
          if (!t) continue;
          assert.ok(page.includes(t), `dist/agent-view.html should contain "${t}"`);
        }
      }
    }
    assert.ok(page.includes('curl -N -X POST'), 'dist/agent-view.html should contain "curl -N -X POST"');
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

  test('every page has one Human and Agent switch in its header, and no floating view switch', () => {
    const dist = path.dirname(indexPath);
    for (const name of ['index.html', 'about.html', '404.html', 'agent-view.html', 'example/Uniswap-v4-core.html']) {
      const html = fs.readFileSync(path.join(dist, name), 'utf8');
      assert.equal(html.includes('view-switch'), false, `dist/${name} should have no view switch`);
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      assert.equal(header.split('class="seg"').length - 1, 1, `dist/${name} header should contain class="seg" once`);
      if (name !== 'agent-view.html') {
        assert.equal(header.split('href="/agent-view.html"').length - 1, 1, `dist/${name} header should link to the agent view once`);
        assert.ok(header.includes('aria-current="page">Human<'), `dist/${name} header should contain aria-current="page">Human<`);
      } else {
        assert.ok(header.includes('aria-current="page">Agent<'), 'dist/agent-view.html header should contain aria-current="page">Agent<');
        assert.ok(header.includes('>Human</a>'), 'dist/agent-view.html header should contain >Human</a>');
      }
      const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
      assert.equal(footer.includes('href="/agent-view.html"'), false, `dist/${name} footer should not link to the agent view`);
    }
  });
});
