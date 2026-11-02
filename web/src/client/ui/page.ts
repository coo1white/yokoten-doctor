import { planSteps, stepTitle, stepsHeadline, stepGetsText, singleStepTitle, toSentence } from "../view.ts";
import { rerunHref } from "../fixes.ts";
import type { CheckResult, ViewModel, ResultPlan, FixesPayload, RecordPayload, StepKey, PlanStep } from "../types.ts";
import { make, renderRichText, createIcon, createRow } from "./dom.ts";
import { renderChecksRow } from "./checks.ts";
import { renderPrivateRow } from "./private.ts";
import { renderProofRow } from "./proof.ts";
import { renderFilesBody, renderInstallBody, renderHandBody } from "./fix.ts";

const doneSteps = new Set<StepKey>();
let openStepKey: StepKey | "" | null = null;

export function clearStepProgress(): void {
  doneSteps.clear();
  openStepKey = null;
}

export function renderResultPage(input: { lastResult: CheckResult; vm: ViewModel; plan: ResultPlan; lastFixes: FixesPayload | null; lastRecord: RecordPayload | null; isRecordShown: boolean; isEntering: boolean }): HTMLElement {
  const { lastResult, vm, plan, lastFixes, lastRecord, isRecordShown, isEntering } = input;
  const owner = lastResult.owner ?? "";
  const repo = lastResult.repo ?? "";
  const outer = make("div", "wide f-main");
  const top = renderTop(owner, repo, plan, isEntering);
  outer.appendChild(top);
  const steps = planSteps(plan);
  if (plan.total > 0 && plan.done === plan.total) {
    const section = renderAllDoneSection();
    outer.appendChild(section);
  } else if (steps.length === 0) {
    const section = renderEmptyStepsSection(plan);
    outer.appendChild(section);
  } else if (steps.length === 1) {
    const step = steps[0];
    const section = renderSingleStepSection(step, plan, lastFixes, lastResult, owner, repo);
    outer.appendChild(section);
  } else {
    const { section, allDone } = renderMultiStepSection(steps, plan, lastFixes, lastResult, owner, repo);
    outer.appendChild(section);
    outer.appendChild(allDone);
  }
  const rest = createRestSection(lastResult, plan, lastFixes, vm, lastRecord, isRecordShown);
  outer.appendChild(rest);
  return outer;
}

function renderTop(owner: string, repo: string, plan: ResultPlan, isEntering: boolean): HTMLElement {
  const wrap = make("div", isEntering ? "enter" : undefined);
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
  const rerun = make("a", "link ctl");
  rerun.href = rerunHref(owner, repo);
  rerun.textContent = "Run it again";
  right.appendChild(rerun);
  const copyButton = make("button", "link ctl", "Copy link");
  copyButton.type = "button";
  copyButton.setAttribute("data-copy-url", "");
  right.appendChild(copyButton);
  repoBlock.appendChild(right);
  wrap.appendChild(repoBlock);
  const verdict = make("h1", "f-verdict", `${plan.done} of ${plan.total} checks pass.`);
  wrap.appendChild(verdict);
  const bar = make("div", isEntering ? "bar bar-anim" : "bar");
  bar.setAttribute("aria-hidden", "true");
  for (let index = 0; index < plan.total; index++) {
    const segmentClass = index < plan.done ? "s-done" : "s-files";
    const segment = make("i", segmentClass);
    bar.appendChild(segment);
  }
  wrap.appendChild(bar);
  return wrap;
}

function createWhatToDoSection(): HTMLElement {
  const section = make("section", "f-job f-single");
  section.setAttribute("aria-label", "What to do");
  return section;
}

function shouldShowStepAction(stepKey: StepKey, plan: ResultPlan): boolean {
  return !(stepKey === "files" && (plan.filesBlock === "waiting" || plan.filesBlock === "lost"));
}

function renderAllDoneSection(): HTMLElement {
  const section = createWhatToDoSection();
  const heading = make("h2", undefined, "Nothing to do.");
  section.appendChild(heading);
  const paragraph = make("p", undefined, "These checks read files. They don't judge your code.");
  section.appendChild(paragraph);
  return section;
}

function renderEmptyStepsSection(plan: ResultPlan): HTMLElement {
  const left = plan.total - plan.done;
  const section = createWhatToDoSection();
  const heading = make("h2", undefined, "See what's left");
  section.appendChild(heading);
  const text = `${left} ${left === 1 ? "check is" : "checks are"} still open. The list below says how to fix each one.`;
  const paragraph = make("p", undefined, text);
  section.appendChild(paragraph);
  return section;
}

function renderSingleStepSection(step: PlanStep, plan: ResultPlan, lastFixes: FixesPayload | null, lastResult: CheckResult, owner: string, repo: string): HTMLElement {
  const section = createWhatToDoSection();
  const heading = make("h2");
  renderRichText(singleStepTitle(plan, step), heading);
  section.appendChild(heading);
  if (step.key !== "install") {
    const gets = stepGetsText(step, plan.total);
    if (gets !== "") {
      const paragraphGets = make("p", "f-gets");
      renderRichText(toSentence(gets), paragraphGets);
      section.appendChild(paragraphGets);
    }
  }
  const bodies = getStepBodies(step.key, plan, lastFixes, lastResult);
  for (const node of bodies) section.appendChild(node);
  if (shouldShowStepAction(step.key, plan)) {
    const nextDiv = make("div", "f-next");
    const actionLink = make("a", "btn btn-line ctl");
    actionLink.href = rerunHref(owner, repo);
    actionLink.textContent = "Done? Run the check again";
    nextDiv.appendChild(actionLink);
    section.appendChild(nextDiv);
  }
  return section;
}

function resolveDesiredOpenKey(steps: PlanStep[]): StepKey | "" | null {
  if (openStepKey === "") return "";
  if (openStepKey !== null && steps.some((stepItem) => stepItem.key === openStepKey)) return openStepKey;
  return steps.find((stepItem) => !doneSteps.has(stepItem.key))?.key ?? null;
}

function renderMultiStepSection(steps: PlanStep[], plan: ResultPlan, lastFixes: FixesPayload | null, lastResult: CheckResult, owner: string, repo: string): { section: HTMLElement; allDone: HTMLElement } {
  const section = make("section", "f-job");
  section.setAttribute("aria-label", "What to do");
  const head = make("div", "f-job-head");
  head.textContent = stepsHeadline(steps);
  section.appendChild(head);
  const desiredOpenKey = resolveDesiredOpenKey(steps);
  const lastKey = steps[steps.length - 1].key;
  const allDone = make("p", "f-next");
  allDone.setAttribute("data-all-done", "");
  const allLink = make("a", "btn btn-primary ctl");
  allLink.href = rerunHref(owner, repo);
  allLink.textContent = "Run the check again";
  allDone.appendChild(allLink);
  allDone.hidden = !doneSteps.has(lastKey);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const details = renderStep(step, index, steps, plan, lastFixes, lastResult, desiredOpenKey, section, allDone);
    section.appendChild(details);
  }
  return { section, allDone };
}

function renderStep(step: PlanStep, index: number, steps: PlanStep[], plan: ResultPlan, lastFixes: FixesPayload | null, lastResult: CheckResult, desiredOpenKey: StepKey | "" | null, section: HTMLElement, allDone: HTMLElement): HTMLDetailsElement {
  const isDone = doneSteps.has(step.key);
  const details = make("details", "f-step" + (isDone ? " is-done" : ""));
  details.setAttribute("name", "steps");
  details.id = `step-${step.key}`;
  details.setAttribute("data-step", step.key);
  const isOpen = desiredOpenKey !== null && desiredOpenKey !== "" && desiredOpenKey === step.key;
  details.open = isOpen;
  const summary = make("summary");
  const numSpan = make("span", "f-num");
  if (isDone) {
    const screenReader = make("span", "sr", "Done: ");
    numSpan.appendChild(screenReader);
    numSpan.appendChild(createIcon("check"));
  } else {
    numSpan.textContent = String(index + 1);
  }
  summary.appendChild(numSpan);
  const titleSpan = make("span", "f-title");
  renderRichText(stepTitle(plan, step.key), titleSpan);
  summary.appendChild(titleSpan);
  const gets = stepGetsText(step, plan.total);
  if (gets !== "") {
    const getsSpan = make("span", "f-gets", gets);
    summary.appendChild(getsSpan);
  }
  details.appendChild(summary);
  const bodyDiv = make("div", "f-body");
  const bodies = getStepBodies(step.key, plan, lastFixes, lastResult);
  for (const node of bodies) bodyDiv.appendChild(node);
  if (shouldShowStepAction(step.key, plan)) {
    const nextDiv = make("div", "f-next");
    const button = make("button", "btn btn-primary ctl");
    button.type = "button";
    button.setAttribute("data-done", "");
    button.textContent = index === steps.length - 1 ? "Done" : "Done, next step";
    button.addEventListener("click", () => {
      markStepDone(details, step.key);
      const currentIndex = steps.findIndex((stepItem) => stepItem.key === step.key);
      if (currentIndex < steps.length - 1) {
        const nextKey = steps[currentIndex + 1].key;
        openStepKey = nextKey;
        const nextDetails = section.querySelector<HTMLDetailsElement>(`details[data-step="${nextKey}"]`);
        if (nextDetails) {
          nextDetails.open = true;
          nextDetails.scrollIntoView({ block: "nearest" });
          const summaryElement = nextDetails.querySelector<HTMLElement>("summary");
          if (summaryElement) summaryElement.focus();
        }
      } else {
        details.open = false;
        openStepKey = "";
        allDone.hidden = false;
        const link = allDone.querySelector<HTMLElement>("a");
        if (link) link.focus();
      }
    });
    nextDiv.appendChild(button);
    bodyDiv.appendChild(nextDiv);
  }
  details.appendChild(bodyDiv);
  details.addEventListener("toggle", () => {
    if (details.open) {
      openStepKey = step.key;
    } else if (openStepKey === step.key) {
      openStepKey = "";
    }
  });
  return details;
}

function markStepDone(details: HTMLDetailsElement, stepKey: StepKey): void {
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

function createRestSection(lastResult: CheckResult, plan: ResultPlan, lastFixes: FixesPayload | null, vm: ViewModel, lastRecord: RecordPayload | null, isRecordShown: boolean): HTMLElement {
  const rest = make("section", "f-rest");
  const restTitle = make("h2", undefined, "Nothing below is required");
  rest.appendChild(restTitle);
  const checksRow = renderChecksRow(lastResult, plan);
  rest.appendChild(checksRow);
  if (!plan.filesAreStep && ((lastFixes?.files.length ?? 0) > 0 || lastFixes?.muse === "failed")) {
    const extraBody = renderFilesBody(plan, lastFixes, lastResult);
    const sideText = plan.isAfterKnown ? "won't change the count" : "";
    const extraRow = createRow("Extra files", sideText, extraBody, { key: "extra-files", id: "files" });
    rest.appendChild(extraRow);
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
  return rest;
}

function getStepBodies(stepKey: StepKey, plan: ResultPlan, lastFixes: FixesPayload | null, lastResult: CheckResult): Node[] {
  if (stepKey === "files") return renderFilesBody(plan, lastFixes, lastResult);
  if (stepKey === "install") return renderInstallBody(plan);
  return renderHandBody(plan, lastResult);
}
