import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { resultPlan, resultCommands, nextAction, splitErrorCommand, INSTALL_COMMAND } from "../../web/src/client/view.ts";
import { PATCH_COMMANDS } from "../../web/src/client/fixes.ts";

const EXPECTED = {
  'Fission-AI-OpenSpec': { done: 8, gain: 0, install: 5, hand: 0, order: ['install'], moved: [], handIds: [], label: 'Install yokoten' },
  'NomicFoundation-hardhat': { done: 6, gain: 2, install: 5, hand: 0, order: ['files', 'install'], moved: [], handIds: [], label: 'Get the files' },
  'OpenZeppelin-openzeppelin-contracts': { done: 7, gain: 0, install: 5, hand: 1, order: ['files', 'install', 'hand'], moved: [], handIds: ['import'], label: 'Get the file' },
  'Uniswap-v4-core': { done: 4, gain: 3, install: 5, hand: 1, order: ['files', 'install', 'hand'], moved: [], handIds: ['no-build-output'], label: 'Get the files' },
  'cline-cline': { done: 7, gain: 0, install: 6, hand: 0, order: ['install'], moved: ['changelog'], handIds: [], label: 'Install yokoten' },
  'expressjs-express': { done: 2, gain: 4, install: 6, hand: 1, order: ['files', 'install', 'hand'], moved: ['changelog'], handIds: ['tests'], label: 'Get the files' },
  'fastapi-fastapi': { done: 3, gain: 5, install: 5, hand: 0, order: ['files', 'install'], moved: [], handIds: [], label: 'Get the files' },
  'jup-ag-jupiter-quote-api-node': { done: 2, gain: 4, install: 5, hand: 2, order: ['files', 'install', 'hand'], moved: [], handIds: ['tests', 'security-files'], label: 'Get the files' },
};

function loadExample(slug) {
  const p = path.join(process.cwd(), "web/src/data/examples", `${slug}.json`);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

for (const [slug, exp] of Object.entries(EXPECTED)) {
  test(`result plan for ${slug}`, () => {
    const data = loadExample(slug);
    const plan = resultPlan(data.result, data.fixes, false);
    assert.equal(plan.done, exp.done);
    assert.equal(plan.gain, exp.gain);
    assert.equal(plan.installSteps.length, exp.install);
    assert.equal(plan.handCount, exp.hand);
    assert.deepEqual(plan.stepOrder, exp.order);
    assert.deepEqual(plan.movedToInstall.map((s) => s.id), exp.moved);
    const handIds = plan.handItems.map((h) => h.id).sort();
    assert.deepEqual(handIds, [...exp.handIds].sort());
    assert.equal(plan.action?.label, exp.label);
    assert.equal(plan.done + plan.gain + plan.installSteps.length + plan.handCount, plan.total);
    assert.equal(plan.isHandListShort, false);
    assert.equal(plan.segments.length, plan.total);
  });
}

test("only steps that move the count are numbered, and the first step is what \"Do this first\" points at", () => {
  const map = { "#files": "files", "#install": "install", "#hand": "hand" };
  for (const slug of Object.keys(EXPECTED)) {
    const data = loadExample(slug);
    const plan = resultPlan(data.result, data.fixes, false);
    const href = plan.action?.href ?? "";
    const mapped = map[href];
    if (mapped) assert.equal(plan.stepOrder[0], mapped);
    if (plan.gain === 0 && plan.action?.href !== "#files") {
      assert.equal(plan.stepOrder.includes("files"), false);
    }
  }
});

test("no command shows twice on one result page", () => {
  for (const slug of Object.keys(EXPECTED)) {
    const data = loadExample(slug);
    const plan = resultPlan(data.result, data.fixes, false);
    const cmds = [...resultCommands(plan)];
    if (Array.isArray(PATCH_COMMANDS)) cmds.push(...PATCH_COMMANDS);
    else if (PATCH_COMMANDS) cmds.push(PATCH_COMMANDS);
    const rerun = [data.result.rerun?.doctor, data.result.rerun?.check].filter(Boolean).join("\n");
    if (rerun) cmds.push(rerun);
    const uniq = new Set(cmds.filter(Boolean));
    assert.equal(uniq.size, cmds.filter(Boolean).length);
  }
});

test("a by-hand step never repeats the install command when the page has an install step", () => {
  for (const slug of Object.keys(EXPECTED)) {
    const data = loadExample(slug);
    const plan = resultPlan(data.result, data.fixes, false);
    if (plan.installStepNumber > 0) {
      for (const item of plan.handItems) {
        assert.notEqual(item.command, INSTALL_COMMAND);
      }
    }
  }
});

test("build output paths show once, in the command", () => {
  const data = loadExample("Uniswap-v4-core");
  const plan = resultPlan(data.result, data.fixes, false);
  const item = plan.handItems.find((h) => h.id === "no-build-output");
  assert.ok(item);
  assert.deepEqual(item.list, []);
  assert.ok(item.command.startsWith("git rm --cached test/js-scripts/dist/"));
});

test("the tests step points at the install step", () => {
  const data = loadExample("expressjs-express");
  const plan = resultPlan(data.result, data.fixes, false);
  const item = plan.handItems.find((h) => h.id === "tests");
  assert.ok(item);
  assert.equal(item.command, "");
  assert.ok(item.after.startsWith("The command in Step 2 adds .github/workflows/yokoten.yml. In that file, "));
});

test("the license stays by hand when the files can't add it", () => {
  const data = loadExample("jup-ag-jupiter-quote-api-node");
  const plan = resultPlan(data.result, data.fixes, false);
  const item = plan.handItems.find((h) => h.id === "security-files");
  assert.ok(item);
  assert.equal(item.title, "Add a license");
});

test("with no install step, the changelog stays by hand with its command", () => {
  const result = {
    summary: { done: 12, total: 13, next: { id: 'changelog', title: 'Keep a changelog' }, steps: [{ id: 'changelog', title: 'Keep a changelog', mark: 'next', what: 'no changelog', fix: '`yokoten init` adds both; then each pull request adds a file' }], install_only: [] },
  };
  const fixes = { files: [], muse: 'ok', after: { done: 12, total: 13 } };
  const plan = resultPlan(result, fixes, false);
  assert.deepEqual(plan.movedToInstall.map((s) => s.id), []);
  assert.equal(plan.handCount, 1);
  assert.equal(plan.handItems[0].command, INSTALL_COMMAND);
  assert.equal(plan.installStepNumber, 0);
  assert.equal(resultCommands(plan).length, 1);
});

test("waiting for files: no count is claimed beyond what is known", () => {
  const data = loadExample("Uniswap-v4-core");
  const plan = resultPlan(data.result, null, true);
  assert.equal(plan.filesBlock, "waiting");
  assert.equal(plan.legend.length, 0);
  assert.equal(plan.action?.label, "See how");
  assert.equal(plan.stepOrder[0], "files");
});

test("lost files: the one primary is run it again", () => {
  const data = loadExample("Uniswap-v4-core");
  const fixes = { files: [], summary: '', muse: 'lost' };
  const plan = resultPlan(data.result, fixes, false);
  assert.equal(plan.filesBlock, "lost");
  assert.equal(plan.action?.isQuiet, true);
  assert.equal(plan.filesTitle, "Your files didn't arrive");
});

test("an install step is a link inside the page, and repo settings go to GitHub", () => {
  assert.equal(nextAction({ id: 'ci' }, [{ id: 'ci' }], [], 'o', 'r', false).href, "#install");
  assert.equal(nextAction({ id: 'issues' }, [], [], 'o', 'r', false).href, "https://github.com/o/r/settings");
});

test("splitErrorCommand splits a trailing npx yokoten", () => {
  let r = splitErrorCommand("That repo is private. This page checks public repos only. On your machine: npx yokoten");
  assert.equal(r.text, "That repo is private. This page checks public repos only. On your machine:");
  assert.equal(r.command, "npx yokoten");
  r = splitErrorCommand("10 checks this hour is the limit. Try later, or run it on your machine: npx yokoten");
  assert.equal(r.text, "10 checks this hour is the limit. Try later, or run it on your machine:");
  assert.equal(r.command, "npx yokoten");
  r = splitErrorCommand("The connection dropped. Try again.");
  assert.equal(r.text, "The connection dropped. Try again.");
  assert.equal(r.command, "");
});
