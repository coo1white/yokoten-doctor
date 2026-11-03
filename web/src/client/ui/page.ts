import { rerunHref, savedCheckHref, repoFileHref, claudeFileFromStep, projectSection, understoodSections, isClaudeFileLink } from "../fixes.ts";
import type { CheckResult, ViewModel, FixesPayload, RecordPayload, SaveStepKey, ResultScreen, FixFile } from "../types.ts";
import { make, renderRichText, createIcon, createRow, createCommandBox } from "./dom.ts";
import { renderChecksRow } from "./checks.ts";
import { renderPrivateRow } from "./private.ts";
import { renderProofRow } from "./proof.ts";
import { renderSaveStepBody, renderOtherFilesBody, renderOptionalBody } from "./fix.ts";
import { toSentence } from "../view.ts";

const doneSteps = new Set<SaveStepKey>();
let openStepKey: SaveStepKey | "" | null = null;
let isTemplateShown = false;

export function clearStepProgress(): void {
  doneSteps.clear();
  openStepKey = null;
  isTemplateShown = false;
}

type ResultContext = {
  owner: string;
  repo: string;
  branch: string | null;
  agentsFile: FixFile | null;
  lastResult: CheckResult;
  isExample: boolean;
  isSavedCheck: boolean;
  onBackToSteps: () => void;
};

function createPageHead(title: string, lede?: string): Node[] {
  const nodes: Node[] = [];
  nodes.push(make("h1", "f-verdict", title));
  if (lede !== undefined) {
    nodes.push(make("p", "f-lede", lede));
  }
  return nodes;
}

function createExternalLink(text: string, href: string, className?: string): HTMLAnchorElement {
  const link = make("a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function createTemplateReveal(buttonClass: string, buttonText: string, context: ResultContext, agentsFile: FixFile): { button: HTMLElement; section: HTMLElement } {
  const { owner, repo, branch } = context;
  const button = make("button", buttonClass, buttonText);
  button.type = "button";
  const section = createSaveStepsSection({ owner, repo, branch, agentsFile, isWrittenByAi: false, isPreview: false });
  section.hidden = !isTemplateShown;
  button.addEventListener("click", () => {
    isTemplateShown = true;
    section.hidden = false;
    section.scrollIntoView({ block: "nearest" });
    const firstSummary = section.querySelector<HTMLElement>("summary");
    if (firstSummary) firstSummary.focus();
  });
  return { button, section };
}

function createRepoRow(owner: string, repo: string): HTMLElement {
  const repoBlock = make("div", "f-repo");
  const link = make("a", "name");
  link.href = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  link.appendChild(document.createTextNode(owner));
  link.appendChild(document.createTextNode("/"));
  link.appendChild(document.createElement("wbr"));
  link.appendChild(document.createTextNode(repo));
  repoBlock.appendChild(link);
  const saved = document.getElementById("saved-check");
  if (saved instanceof HTMLElement) {
    const value = saved.dataset.saved;
    if (value) {
      const label = make("span", undefined, `Saved ${value}`);
      repoBlock.appendChild(label);
    }
  }
  const right = make("span", "f-right");
  const rerun = make("a", "link ctl", "Run it again");
  rerun.href = rerunHref(owner, repo);
  right.appendChild(rerun);
  const copyButton = make("button", "link ctl", "Copy link");
  copyButton.type = "button";
  copyButton.setAttribute("data-copy-url", "");
  right.appendChild(copyButton);
  repoBlock.appendChild(right);
  return repoBlock;
}

function createExampleBlock(): HTMLElement {
  const section = make("section", "f-job f-single");
  const h2 = make("h2", undefined, "This is someone else's project.");
  section.appendChild(h2);
  const p = make("p", undefined, "You can't save this here. Check your own project to see what the AI understands from it.");
  section.appendChild(p);
  const actions = make("div", "save-actions");
  const link = make("a", "btn btn-primary ctl", "Check your own project");
  link.href = "/";
  actions.appendChild(link);
  section.appendChild(actions);
  return section;
}

function resolveDesiredOpenKey(keys: SaveStepKey[]): SaveStepKey | "" | null {
  if (openStepKey === "") return "";
  if (openStepKey !== null && keys.includes(openStepKey)) return openStepKey;
  return keys.find((k) => !doneSteps.has(k)) ?? null;
}

function markStepDone(details: HTMLDetailsElement, stepKey: SaveStepKey): void {
  doneSteps.add(stepKey);
  details.classList.add("is-done");
  const numberElement = details.querySelector<HTMLElement>(".f-num");
  if (numberElement) {
    numberElement.textContent = "";
    const screenReader = make("span", "sr", "Done: ");
    numberElement.appendChild(screenReader);
    numberElement.appendChild(createIcon("check"));
  }
}

function createStep(key: SaveStepKey, index: number, order: SaveStepKey[], section: HTMLElement, context: { owner: string; repo: string; branch: string | null; agentsFile: FixFile; isWrittenByAi: boolean; isPreview: boolean }): HTMLElement {
  const isDone = doneSteps.has(key);
  const details = make("details", "f-step" + (isDone ? " is-done" : ""));
  details.setAttribute("name", "steps");
  details.id = `step-${key}`;
  details.setAttribute("data-step", key);
  const desiredOpenKey = resolveDesiredOpenKey(order);
  const isOpen = desiredOpenKey !== null && desiredOpenKey !== "" && desiredOpenKey === key;
  details.open = isOpen;
  let isFirstToggleIgnored = details.open;
  const summary = make("summary");
  const numSpan = make("span", "f-num");
  if (isDone) {
    const sr = make("span", "sr", "Done: ");
    numSpan.appendChild(sr);
    numSpan.appendChild(createIcon("check"));
  } else {
    numSpan.textContent = String(index + 1);
  }
  summary.appendChild(numSpan);
  const titles: Record<SaveStepKey, string> = {
    copy: "Copy the file",
    paste: "Paste it",
    save: "Save it",
    check: "Check that it saved",
  };
  const titleSpan = make("span", "f-title", titles[key]);
  summary.appendChild(titleSpan);
  details.appendChild(summary);
  const bodyDiv = make("div", "f-body save-body");
  let doneButton: HTMLElement | undefined = undefined;
  if (key !== "check") {
    const btn = make("button", "btn btn-line ctl", "Done, next step");
    btn.type = "button";
    btn.setAttribute("data-done", "");
    doneButton = btn;
  }
  const bodies = renderSaveStepBody(key, { owner: context.owner, repo: context.repo, branch: context.branch, agentsFile: context.agentsFile, isWrittenByAi: context.isWrittenByAi, isPreview: context.isPreview, doneButton });
  for (const n of bodies) bodyDiv.appendChild(n);
  if (doneButton) {
    doneButton.addEventListener("click", () => {
      markStepDone(details, key);
      const currentIndex = order.indexOf(key);
      const nextKey = order[currentIndex + 1];
      openStepKey = nextKey;
      const nextDetails = section.querySelector<HTMLDetailsElement>(`details[data-step="${nextKey}"]`);
      if (nextDetails) {
        nextDetails.open = true;
        nextDetails.scrollIntoView({ block: "nearest" });
        const sum = nextDetails.querySelector<HTMLElement>("summary");
        if (sum) sum.focus();
      }
    });
  }
  details.appendChild(bodyDiv);
  details.addEventListener("toggle", () => {
    if (isFirstToggleIgnored) {
      isFirstToggleIgnored = false;
      return;
    }
    if (details.open) {
      openStepKey = key;
    } else if (openStepKey === key) {
      openStepKey = "";
    }
  });
  return details;
}

function createSaveStepsSection(input: { owner: string; repo: string; branch: string | null; agentsFile: FixFile; isWrittenByAi: boolean; isPreview: boolean }): HTMLElement {
  const { owner, repo, branch, agentsFile, isWrittenByAi, isPreview } = input;
  const section = make("section", "f-job");
  section.setAttribute("aria-label", "Save it to your project");
  const head = make("div", "save-head");
  if (isPreview) {
    head.appendChild(make("h2", undefined, "This is someone else's project."));
    head.appendChild(make("p", undefined, "You can't save this here. Check your own project to see what the AI understands from it."));
    const actions = make("div", "save-actions");
    const link = make("a", "btn btn-primary ctl", "Check your own project");
    link.href = "/";
    actions.appendChild(link);
    head.appendChild(actions);
    head.appendChild(make("p", "save-preview-note", "On your own project, these are the steps."));
  } else if (isWrittenByAi) {
    head.appendChild(make("h2", undefined, "Is this right? Save it to your project."));
    head.appendChild(make("p", undefined, "It goes in a file called AGENTS.md. Some AI tools read that file when they start. Check that yours does."));
    const p2 = make("p");
    p2.appendChild(document.createTextNode("Not right? You can fix the text on GitHub when you paste it. Or save a fix to your README, then "));
    const link = make("a", undefined, "run it again");
    link.href = rerunHref(owner, repo);
    p2.appendChild(link);
    p2.appendChild(document.createTextNode("."));
    head.appendChild(p2);
  } else {
    head.appendChild(make("h2", undefined, "Add the template to your project."));
    head.appendChild(make("p", undefined, "It goes in a file called AGENTS.md. Some AI tools read that file when they start. Check that yours does."));
    head.appendChild(make("p", undefined, "The file has a place for how to build it, how to test it, and what not to touch. Fill them in on GitHub when you paste it, or later."));
  }
  section.appendChild(head);
  const order: SaveStepKey[] = ["copy", "paste", "save", "check"];
  for (let index = 0; index < order.length; index++) {
    const key = order[index];
    const details = createStep(key, index, order, section, input);
    section.appendChild(details);
  }
  return section;
}

function createRestSection(lastResult: CheckResult, lastFixes: FixesPayload | null, vm: ViewModel, lastRecord: RecordPayload | null, isRecordShown: boolean, isExample: boolean): HTMLElement {
  const rest = make("section", "f-rest");
  const restTitle = make("h2", undefined, "More details");
  rest.appendChild(restTitle);
  const checksRow = renderChecksRow(lastResult);
  rest.appendChild(checksRow);
  const otherFiles = (lastFixes?.files ?? []).filter((f) => f.path !== "AGENTS.md");
  if (otherFiles.length > 0) {
    const n = otherFiles.length;
    const side = n === 1 ? "1 template" : `${n} templates`;
    const body = renderOtherFilesBody(lastFixes, lastResult, isExample);
    const row = createRow("Other files", side, body, { key: "extra-files", id: "files" });
    rest.appendChild(row);
  }
  const privateRow = renderPrivateRow({ vm });
  if (privateRow) rest.appendChild(privateRow);
  if (isRecordShown) {
    const proofRow = renderProofRow({ vm, lastRecord });
    rest.appendChild(proofRow);
  }
  const summaryText = lastFixes?.summary?.trim() ?? "";
  if (summaryText !== "") {
    const paragraph = make("p", undefined, summaryText);
    const summaryRow = createRow("What this repo is", "Summary by Muse", [paragraph], { key: "repo-summary" });
    rest.appendChild(summaryRow);
  }
  const optionalBody = renderOptionalBody(lastResult);
  const optionalRow = createRow("Optional: yokoten", "Your project doesn't need it", optionalBody, { key: "optional-yokoten" });
  rest.appendChild(optionalRow);
  return rest;
}

function renderUnderstood(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo, branch, isExample } = context;
  const file = context.agentsFile!;
  const top: Node[] = [];
  top.push(...createPageHead("Here's what an AI understood.", "It read some of this project's files and wrote this. It can be wrong."));
  const sections = understoodSections(file.content);
  const know = make("section", "f-know");
  know.setAttribute("aria-label", "What the AI understood");
  if (sections) {
    for (const sec of sections) {
      const div = make("div");
      const h2 = make("h2", undefined, sec.title);
      div.appendChild(h2);
      for (const line of sec.lines) {
        const p = make("p");
        renderRichText(line, p);
        div.appendChild(p);
      }
      know.appendChild(div);
    }
  } else {
    const content = projectSection(file.content);
    const div = make("div");
    const lines = content.split("\n");
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) continue;
      if (t === "## This project") continue;
      if (t.startsWith("```")) continue;
      if (t.startsWith("### ")) {
        const h2 = make("h2", undefined, t.slice(4));
        div.appendChild(h2);
        continue;
      }
      const p = make("p");
      renderRichText(t, p);
      div.appendChild(p);
    }
    know.appendChild(div);
  }
  top.push(know);
  top.push(make("p", "f-grade", "This isn't a grade. We can't tell you how well an AI will work on your project."));
  const job = createSaveStepsSection({ owner, repo, branch, agentsFile: file, isWrittenByAi: true, isPreview: isExample });
  return { top, job };
}

function renderWaiting(): { top: Node[]; job: HTMLElement | null } {
  const top: Node[] = [];
  top.push(...createPageHead("An AI is reading this project."));
  const w = make("div", "f-wait");
  w.setAttribute("role", "status");
  const i = make("i");
  i.setAttribute("aria-hidden", "true");
  w.appendChild(i);
  const span = make("span", undefined, "This part can take a little longer.");
  w.appendChild(span);
  top.push(w);
  return { top, job: null };
}

function renderSaved(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo, branch } = context;
  const top: Node[] = [];
  top.push(...createPageHead("Saved. AGENTS.md is in your project."));
  const lede = make("p", "f-lede");
  lede.appendChild(createExternalLink("See it on GitHub", repoFileHref(owner, repo, branch, "blob", "AGENTS.md")));
  top.push(lede);
  const section = make("section", "f-job f-single f-try");
  section.appendChild(make("h2", undefined, "Now try it."));
  section.appendChild(make("p", undefined, "Open your AI tool in this project, and ask it this:"));
  section.appendChild(createCommandBox("What should you not touch in this project?"));
  const p2 = make("p");
  p2.appendChild(document.createTextNode("If it mentions what you saved, it probably read the file. If it doesn't, your tool may not read AGENTS.md. "));
  p2.appendChild(createExternalLink("See which tools do", "https://agents.md/"));
  p2.appendChild(document.createTextNode("."));
  section.appendChild(p2);
  const p3 = make("p", "small muted", "No AI tool yet? You're done. The file will be there when you start. When your project changes, update the file.");
  section.appendChild(p3);
  return { top, job: section };
}

function renderOneMoreLine(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo, branch, lastResult, isSavedCheck } = context;
  const top: Node[] = [];
  const rulesStep = (lastResult.summary?.steps ?? []).find((s) => s.id === "rules");
  const linkFix = rulesStep?.fix ?? "";
  if (isClaudeFileLink(linkFix)) {
    const h1Text = isSavedCheck ? "Saved. One more line for Claude Code." : "One more line for Claude Code.";
    top.push(...createPageHead(h1Text));
    const lede = make("p", "f-lede");
    renderRichText(toSentence(linkFix), lede);
    top.push(lede);
    const actions = make("div", "save-actions");
    const checkLink = make("a", "btn btn-primary ctl", "Check again");
    checkLink.href = savedCheckHref(owner, repo);
    actions.appendChild(checkLink);
    top.push(actions);
    return { top, job: null };
  }
  const { file, line } = claudeFileFromStep(rulesStep?.what);
  const h1Text = isSavedCheck ? "Saved. One more line for Claude Code." : "One more line for Claude Code.";
  top.push(...createPageHead(h1Text, `Your project also has a ${file}, so Claude Code won't read AGENTS.md by default. Add this line to ${file}:`));
  const box = createCommandBox(line);
  box.classList.add("save-line");
  top.push(box);
  const actions = make("div", "save-actions");
  actions.appendChild(createExternalLink(`Open ${file} on GitHub`, repoFileHref(owner, repo, branch, "edit", file), "btn btn-primary ctl"));
  const checkLink = make("a", "btn btn-line ctl", "Check again");
  checkLink.href = savedCheckHref(owner, repo);
  actions.appendChild(checkLink);
  top.push(actions);
  return { top, job: null };
}

function renderNotFound(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo, onBackToSteps } = context;
  const top: Node[] = [];
  top.push(...createPageHead("We don't see AGENTS.md yet.", "It has to reach your main branch. If GitHub showed a green Create pull request button, click it, then click Merge pull request."));
  const actions = make("div", "save-actions");
  const again = make("a", "btn btn-primary ctl", "Check again");
  again.href = savedCheckHref(owner, repo);
  actions.appendChild(again);
  const back = make("button", "btn btn-line ctl", "Back to the steps");
  back.type = "button";
  back.addEventListener("click", () => onBackToSteps());
  actions.appendChild(back);
  top.push(actions);
  return { top, job: null };
}

function renderAlreadyHas(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo, branch, isExample } = context;
  const top: Node[] = [];
  top.push(...createPageHead("This project already has an AGENTS.md."));
  const lede = make("p", "f-lede");
  lede.appendChild(document.createTextNode("We didn't write a new one. "));
  lede.appendChild(createExternalLink("Read it on GitHub", repoFileHref(owner, repo, branch, "blob", "AGENTS.md")));
  lede.appendChild(document.createTextNode(", and keep it true. Then ask your AI tool what it shouldn't touch in this project, and see if the answer matches."));
  top.push(lede);
  let job: HTMLElement | null = null;
  if (isExample) {
    job = createExampleBlock();
  }
  return { top, job };
}

function renderTooBig(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const top: Node[] = [];
  top.push(...createPageHead("This project is too big for the AI to read here.", "We didn't write anything about it. You can still add an AGENTS.md from our template, then write how to build it, how to test it, and what not to touch yourself."));
  const { button, section } = createTemplateReveal("btn btn-primary ctl", "Add the template", context, context.agentsFile!);
  const actions = make("div", "save-actions");
  actions.appendChild(button);
  top.push(actions);
  return { top, job: section };
}

function renderFailed(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo, agentsFile } = context;
  const top: Node[] = [];
  top.push(...createPageHead("The AI couldn't read this project this time.", "This doesn't say anything about your project."));
  const actions = make("div", "save-actions");
  const run = make("a", "btn btn-primary ctl", "Run it again");
  run.href = rerunHref(owner, repo);
  actions.appendChild(run);
  let job: HTMLElement | null = null;
  if (agentsFile) {
    const { button, section } = createTemplateReveal("btn btn-line ctl", "Add the template instead", context, agentsFile);
    actions.appendChild(button);
    job = section;
  }
  actions.appendChild(createExternalLink("Report a problem", "https://github.com/coo1white/yokoten-doctor/issues", "link ctl"));
  top.push(actions);
  return { top, job };
}

function renderNoFile(context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  const { owner, repo } = context;
  const top: Node[] = [];
  top.push(...createPageHead("We couldn't get a file ready for this project.", "This doesn't say anything about your project. You can run it again, or run the check on your machine:"));
  const box = createCommandBox("npx yokoten");
  box.classList.add("save-line");
  top.push(box);
  const actions = make("div", "save-actions");
  const run = make("a", "btn btn-primary ctl", "Run it again");
  run.href = rerunHref(owner, repo);
  actions.appendChild(run);
  actions.appendChild(createExternalLink("Report a problem", "https://github.com/coo1white/yokoten-doctor/issues", "link ctl"));
  top.push(actions);
  return { top, job: null };
}

function renderScreen(screen: ResultScreen, context: ResultContext): { top: Node[]; job: HTMLElement | null } {
  switch (screen) {
    case "understood":
      return renderUnderstood(context);
    case "waiting":
      return renderWaiting();
    case "saved":
      return renderSaved(context);
    case "one more line":
      return renderOneMoreLine(context);
    case "not found":
      return renderNotFound(context);
    case "already has":
      return renderAlreadyHas(context);
    case "too big":
      return renderTooBig(context);
    case "failed":
      return renderFailed(context);
    case "no file":
      return renderNoFile(context);
  }
}

export function renderResultPage(input: { lastResult: CheckResult; vm: ViewModel; screen: ResultScreen; lastFixes: FixesPayload | null; lastRecord: RecordPayload | null; isRecordShown: boolean; isEntering: boolean; isExample: boolean; isSavedCheck: boolean; onBackToSteps: () => void }): HTMLElement {
  const { lastResult, vm, screen, lastFixes, lastRecord, isRecordShown, isEntering, isExample, isSavedCheck, onBackToSteps } = input;
  const owner = String(lastResult.owner ?? "");
  const repo = String(lastResult.repo ?? "");
  const branch: string | null = lastResult.default_branch ?? lastResult.branch ?? null;
  const agentsFile = (lastFixes?.files ?? []).find((f) => f.path === "AGENTS.md") ?? null;
  const outer = make("div", "wide f-main");
  const topWrap = make("div", isEntering ? "enter" : undefined);
  topWrap.appendChild(createRepoRow(owner, repo));
  const context: ResultContext = { owner, repo, branch, agentsFile, lastResult, isExample, isSavedCheck, onBackToSteps };
  const result = renderScreen(screen, context);
  for (const node of result.top) topWrap.appendChild(node);
  outer.appendChild(topWrap);
  if (result.job) outer.appendChild(result.job);
  const rest = createRestSection(lastResult, lastFixes, vm, lastRecord, isRecordShown, isExample);
  outer.appendChild(rest);
  return outer;
}
