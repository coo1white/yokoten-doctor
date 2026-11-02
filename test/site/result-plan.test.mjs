import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { resultPlan, resultCommands, nextAction, splitErrorCommand, INSTALL_COMMAND, planSteps, stepsHeadline, stepGetsText, singleStepTitle } from "../../web/src/client/view.ts";
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
    assert.deepEqual(plan.handItems.map((h) => h.id), exp.handIds);
    assert.equal(plan.action?.label, exp.label);
    assert.equal(plan.done + plan.gain + plan.installSteps.length + plan.handCount, plan.total);
    assert.equal(plan.isHandListShort, false);
  });
}

test("the first step is the one the plan's action points at", () => {
  const map = { "#files": "files", "#install": "install", "#hand": "hand" };
  for (const slug of Object.keys(EXPECTED)) {
    const data = loadExample(slug);
    const plan = resultPlan(data.result, data.fixes, false);
    const href = plan.action?.href ?? "";
    const mapped = map[href];
    assert.ok(mapped, `action href ${href} should map to a step for ${slug}`);
    assert.equal(plan.stepOrder[0], mapped);
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

test("a single by-hand step takes its title from the item", () => {
  let data = loadExample("OpenZeppelin-openzeppelin-contracts");
  let plan = resultPlan(data.result, data.fixes, false);
  assert.equal(plan.handTitle, "Add one line to CLAUDE.md");
  data = loadExample("Uniswap-v4-core");
  plan = resultPlan(data.result, data.fixes, false);
  assert.equal(plan.handTitle, "Keep build output out of git");
  data = loadExample("expressjs-express");
  plan = resultPlan(data.result, data.fixes, false);
  assert.equal(plan.handTitle, "Run your tests on every push");
  data = loadExample("jup-ag-jupiter-quote-api-node");
  plan = resultPlan(data.result, data.fixes, false);
  assert.equal(plan.handTitle, "Fix these 2 by hand");
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

test("with no install step, the tests step shows its own command", () => {
  const result = {
    summary: { done: 12, total: 13, next: { id: 'tests', title: 'Run your tests on every push' }, steps: [{ id: 'tests', title: 'Run your tests on every push', mark: 'next', what: 'CI does not run the tests yet', fix: 'run `yokoten init` to add .github/workflows/yokoten.yml, then in it, add a tests job' }], install_only: [] },
  };
  const fixes = { files: [], muse: 'ok', after: { done: 12, total: 13 } };
  const plan = resultPlan(result, fixes, false);
  assert.equal(plan.handItems[0].command, INSTALL_COMMAND);
  assert.ok(plan.handItems[0].after.startsWith("It adds .github/workflows/yokoten.yml. In that file, "));
  assert.equal(resultCommands(plan).length, 1);
});

test("waiting for files: no count is claimed beyond what is known", () => {
  const data = loadExample("Uniswap-v4-core");
  const plan = resultPlan(data.result, null, true);
  assert.equal(plan.filesBlock, "waiting");
  assert.ok(planSteps(plan).every((step) => step.target === null));
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

test("targets come from the plan", () => {
  let data = loadExample("Uniswap-v4-core");
  let plan = resultPlan(data.result, data.fixes, false);
  assert.deepEqual(planSteps(plan).map((s) => s.target), [7, 12, 13]);
  data = loadExample("jup-ag-jupiter-quote-api-node");
  plan = resultPlan(data.result, data.fixes, false);
  assert.deepEqual(planSteps(plan).map((s) => s.target), [6, 11, 13]);
  data = loadExample("cline-cline");
  plan = resultPlan(data.result, data.fixes, false);
  assert.deepEqual(planSteps(plan).map((s) => s.target), [13]);
});

test("a step that moves nothing says so", () => {
  const data = loadExample("OpenZeppelin-openzeppelin-contracts");
  const plan = resultPlan(data.result, data.fixes, false);
  const steps = planSteps(plan);
  assert.equal(steps[0].isMovingCount, false);
  assert.equal(stepGetsText(steps[0], plan.total), "the count stays at 7");
  assert.equal(stepGetsText(steps[1], plan.total), "gets you to 12 of 13");
});

test("a short list never claims the total", () => {
  const result = { summary: { done: 10, total: 13, next: null, steps: [{ id: 'titles', title: 'Check pull request titles', mark: 'to do', what: 'x', fix: 'y' }], install_only: [] } };
  const fixes = { files: [], muse: 'ok', after: { done: 10, total: 13 } };
  const plan = resultPlan(result, fixes, false);
  assert.equal(plan.isHandListShort, true);
  const steps = planSteps(plan);
  assert.equal(steps[steps.length - 1].target, 11);
  const headline = stepsHeadline(steps);
  const lastText = stepGetsText(steps[steps.length - 1], plan.total);
  assert.equal(headline.includes("13 of 13"), false);
  assert.equal(lastText.includes("13 of 13"), false);
});

test("the headline", () => {
  let data = loadExample("Uniswap-v4-core");
  let plan = resultPlan(data.result, data.fixes, false);
  assert.equal(stepsHeadline(planSteps(plan)), "Three steps get you to 13. Do them in order.");
  plan = resultPlan(data.result, null, true);
  assert.equal(stepsHeadline(planSteps(plan)), "Two steps. Do them in order.");
});

test("the single-step title", () => {
  const data = loadExample("cline-cline");
  const plan = resultPlan(data.result, data.fixes, false);
  const steps = planSteps(plan);
  assert.equal(singleStepTitle(plan, steps[0]), "Run one command to get to 13 of 13");
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
