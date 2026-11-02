import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isCodePath, run } from './check-muse-receipts.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'receipts-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(repo, 'web/src'), { recursive: true });
  writeFileSync(join(repo, 'web/src/page.ts'), 'old\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { repo, git, base: git('rev-parse', 'HEAD').trim() };
}

function commitChange(context, path, text, receipts) {
  writeFileSync(join(context.repo, path), text);
  if (receipts) writeFileSync(join(context.repo, 'muse-receipts.json'), JSON.stringify(receipts));
  context.git('add', '.');
  context.git('commit', '-qm', 'change');
}

test('code paths cover the site, the server, the tests and root config', () => {
  for (const path of ['web/src/a.ts', 'web/src/a.astro', 'web/public/js/a.js', 'web/src/styles/a.css', 'server/a.py', 'test/web/a.test.mjs', 'astro.config.mjs', 'conftest.py']) {
    assert.equal(isCodePath(path), true, path);
  }
  for (const path of ['README.md', 'docs/design.md', '.github/workflows/test.yml', '.github/workflows/check-muse-receipts.mjs', 'web/src/data/examples/a.json', 'muse-receipts.json']) {
    assert.equal(isCodePath(path), false, path);
  }
});

test('a hand change with no receipt fails', (t) => {
  const context = makeRepo();
  t.after(() => rmSync(context.repo, { recursive: true }));
  commitChange(context, 'web/src/page.ts', 'by hand\n');
  assert.deepEqual(run(context.repo, context.base), ['web/src/page.ts: no Muse receipt']);
});

test('a hand change after Muse wrote the file fails', (t) => {
  const context = makeRepo();
  t.after(() => rmSync(context.repo, { recursive: true }));
  commitChange(context, 'web/src/page.ts', 'by hand\n', { 'web/src/page.ts': { sha256: hash('by Muse\n') } });
  assert.deepEqual(run(context.repo, context.base), ['web/src/page.ts: changed after Muse wrote it']);
});

test('a file that matches its receipt passes', (t) => {
  const context = makeRepo();
  t.after(() => rmSync(context.repo, { recursive: true }));
  commitChange(context, 'web/src/page.ts', 'by Muse\n', { 'web/src/page.ts': { sha256: hash('by Muse\n') } });
  assert.deepEqual(run(context.repo, context.base), []);
});

test('a docs change needs no receipt', (t) => {
  const context = makeRepo();
  t.after(() => rmSync(context.repo, { recursive: true }));
  commitChange(context, 'README.md', 'docs\n');
  assert.deepEqual(run(context.repo, context.base), []);
});
