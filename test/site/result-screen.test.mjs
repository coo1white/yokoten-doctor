import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resultScreen, OPTIONAL_CHECK_IDS, splitErrorCommand } from '../../web/src/client/view.ts';
import { understoodSections, claudeFileFromStep } from '../../web/src/client/fixes.ts';

const NO = "no AGENTS.md, so the agents have no written rules here";
const ONLY = "CLAUDE.md has the rules, but only Claude Code reads them";
const GAP = "CLAUDE.md does not import AGENTS.md, so Claude Code does not read the rules";

function makeResult(mark, what) {
  return { summary: { steps: [{ id: 'rules', mark, what }] } };
}

function makeFixes(muse, hasA) {
  if (muse === null) return null;
  return { files: hasA ? [{ path: 'AGENTS.md', content: 'x' }] : [], muse, summary: '', claude_import: null };
}

describe('resultScreen', () => {
  const contract = JSON.parse(fs.readFileSync(path.resolve('test/fixtures/rules-step-0.2.0.json'), 'utf8'));

  test('the rules fixture is real output of the yokoten version the server runs', () => {
    const server = fs.readFileSync(path.resolve('server/check/sandbox_run.py'), 'utf8');
    const pinned = server.match(/YOKOTEN_VERSION = "([^"]+)"/)[1];
    assert.equal(contract.yokoten_version, pinned, 'the server moved to a new yokoten: capture the rules step again, because the page reads its words');
  });

  test('each real repo shape gets the right screen', () => {
    const expected = {
      'no rules files': { saved: 'not found', fresh: 'understood', file: 'CLAUDE.md' },
      'CLAUDE.md only': { saved: 'not found', fresh: 'understood', file: 'CLAUDE.md' },
      'AGENTS.md only': { saved: 'saved', fresh: 'already has', file: 'CLAUDE.md' },
      'AGENTS.md, CLAUDE.md with no import': { saved: 'one more line', fresh: 'one more line', file: 'CLAUDE.md' },
      'AGENTS.md, .claude/CLAUDE.md with no import': { saved: 'one more line', fresh: 'one more line', file: '.claude/CLAUDE.md' },
      'AGENTS.md, CLAUDE.md with the import': { saved: 'saved', fresh: 'already has', file: 'CLAUDE.md' },
      'AGENTS.md, .claude/CLAUDE.md with the import': { saved: 'saved', fresh: 'already has', file: 'CLAUDE.md' },
    };
    assert.deepEqual(Object.keys(contract.cases).sort(), Object.keys(expected).sort());
    for (const [name, step] of Object.entries(contract.cases)) {
      const result = makeResult(step.mark, step.what);
      const fixes = step.mark === 'done' || step.what.includes('does not import') ? makeFixes('not needed', false) : makeFixes('ok', true);
      assert.equal(resultScreen(result, fixes, true), expected[name].saved, name);
      assert.equal(resultScreen(result, fixes, false), expected[name].fresh, name);
      assert.equal(claudeFileFromStep(step.what).file, expected[name].file, name);
    }
  });

  test('table', () => {
    const cases = [
      ['next', NO, null, false, 'waiting'],
      ['next', NO, { muse: 'ok', hasA: true }, false, 'understood'],
      ['next', ONLY, { muse: 'ok', hasA: true }, false, 'understood'],
      ['next', NO, { muse: 'failed', hasA: true }, false, 'failed'],
      ['next', NO, { muse: 'failed', hasA: false }, false, 'failed'],
      ['next', NO, { muse: 'lost', hasA: false }, false, 'failed'],
      ['next', NO, { muse: 'not needed', hasA: true }, false, 'too big'],
      ['next', NO, { muse: 'not needed', hasA: false }, false, 'no file'],
      ['next', GAP, null, false, 'one more line'],
      ['next', GAP, { muse: 'not needed', hasA: false }, false, 'one more line'],
      ['done', '', null, false, 'already has'],
      ['done', '', { muse: 'not needed', hasA: false }, false, 'already has'],
      ['done', '', { muse: 'failed', hasA: false }, false, 'already has'],
      ['done', '', { muse: 'lost', hasA: false }, false, 'already has'],
      ['done', '', null, true, 'saved'],
      ['done', '', { muse: 'not needed', hasA: false }, true, 'saved'],
      ['next', GAP, null, true, 'one more line'],
      ['next', GAP, { muse: 'failed', hasA: false }, true, 'one more line'],
      ['next', NO, null, true, 'not found'],
      ['next', NO, { muse: 'ok', hasA: true }, true, 'not found'],
      ['next', NO, { muse: 'failed', hasA: false }, true, 'not found'],
      ['next', ONLY, { muse: 'ok', hasA: true }, true, 'not found'],
      ['not now', '', null, false, 'no file'],
      ['not now', '', null, true, 'no file'],
      ['not now', GAP, null, false, 'one more line'],
    ];
    for (const [mark, what, fixDesc, flag, expected] of cases) {
      const result = makeResult(mark, what);
      const fixes = fixDesc === null ? null : makeFixes(fixDesc.muse, fixDesc.hasA);
      assert.equal(resultScreen(result, fixes, flag), expected, `${mark} ${what} ${JSON.stringify(fixDesc)} ${flag} -> ${expected}`);
    }
    const types = fs.readFileSync(path.resolve('web/src/client/types.ts'), 'utf8');
    const screens = [...types.match(/ResultScreen =([^;]+);/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(cases.map((row) => row[4]))].sort(), screens.sort(), 'every screen needs a row in this table');
  });

  test('examples map to understood or already has', () => {
    const examplesDir = path.resolve('web/src/data/examples');
    const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
      const screen = resultScreen(data.result, data.fixes, false);
      const expected = data.fixes.muse === 'ok' ? 'understood' : 'already has';
      assert.equal(screen, expected, `${file} screen`);
      if (data.fixes.muse === 'ok') {
        const ag = data.fixes.files.find((f) => f.path === 'AGENTS.md');
        assert.ok(ag, `${file} should have AGENTS.md`);
        const sections = understoodSections(ag.content);
        assert.ok(sections, `${file} understoodSections should not be null`);
        assert.equal(sections.length, 3, `${file} should have 3 sections`);
      }
    }
  });

  test('OPTIONAL_CHECK_IDS matches server', () => {
    const py = fs.readFileSync(path.resolve('server/check/result.py'), 'utf8');
    const line = py.split('\n').find((l) => l.trim().startsWith('INSTALL_ONLY_IDS'));
    assert.ok(line, 'INSTALL_ONLY_IDS line found');
    const serverIds = [...line.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]).sort();
    assert.deepEqual([...OPTIONAL_CHECK_IDS].sort(), serverIds);
  });

  test("splitErrorCommand splits a trailing npx yokoten", () => {
    assert.deepEqual(splitErrorCommand("The check couldn't finish here. Run it on your machine: npx yokoten"), { text: "The check couldn't finish here. Run it on your machine:", command: "npx yokoten" });
    assert.deepEqual(splitErrorCommand("The check couldn't finish here. Run it on your machine: npx yokoten."), { text: "The check couldn't finish here. Run it on your machine:", command: "npx yokoten" });
    assert.deepEqual(splitErrorCommand("Something else went wrong."), { text: "Something else went wrong.", command: "" });
  });
});
