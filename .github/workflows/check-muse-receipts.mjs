// Fails when a pull request changes site code that does not match what Muse returned.
// apply-json.mjs records each file's hash in muse-receipts.json when it writes Muse's reply.
// Usage: node .github/workflows/check-muse-receipts.mjs <base sha>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_PATH = /^(?:(?:web|server|test)\/.*|[^/]+)\.(?:ts|tsx|jsx|astro|css|js|mjs|py|html|sh)$/;

export function isCodePath(path) {
  return CODE_PATH.test(path);
}

export function findUnreceipted(repo, changedPaths, receipts) {
  const problems = [];
  for (const path of changedPaths.filter(isCodePath)) {
    const receipt = receipts[path];
    if (!receipt) {
      problems.push(`${path}: no Muse receipt`);
      continue;
    }
    const sha256 = createHash('sha256').update(readFileSync(join(repo, path))).digest('hex');
    if (sha256 !== receipt.sha256) problems.push(`${path}: changed after Muse wrote it`);
  }
  return problems;
}

export function run(repo, baseSha) {
  const output = execFileSync('git', ['-C', repo, '-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=ACMR', baseSha, 'HEAD'], { encoding: 'utf8' });
  const changedPaths = output.split('\n').filter(Boolean);
  const receiptsFile = join(repo, 'muse-receipts.json');
  const receipts = existsSync(receiptsFile) ? JSON.parse(readFileSync(receiptsFile, 'utf8')) : {};
  return findUnreceipted(repo, changedPaths, receipts);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const problems = run(process.cwd(), process.argv[2]);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error('Muse writes all site code. Brief Muse, then apply its reply with apply-json.mjs. See AGENTS.md.');
    process.exit(1);
  }
  console.log('Every changed code file matches a Muse receipt.');
}
