const API = "https://yokoten-doctor--yokoten-doctor-fastapi-app.us-east.modal.run";

import { viewModel, repoFromInput, repoFromQuery, resultPlan, splitErrorCommand } from "./view.ts";
import { make, createCommandBox, captureDetailsState, restoreDetailsState } from "./ui/dom.ts";
import { renderSummary } from "./ui/hero.ts";
import { clearOpenedFiles, renderFilesSection, renderInstallSection, renderHandSection } from "./ui/fix.ts";
import { renderPrivateSection } from "./ui/private.ts";
import { proofNavTitle, renderProofSection } from "./ui/proof.ts";
import { renderWorking } from "./ui/working.ts";
import { renderStepNav, startStepSpy } from "./stepper.ts";
import { rerunHref } from "./fixes.ts";
import type { CheckResult, FixesPayload, RecordPayload } from "./types.ts";

const appEl = document.getElementById("app") as HTMLElement | null;
const landingEl = document.getElementById("landing") as HTMLElement | null;
const checkForm = document.getElementById("check-form") as HTMLFormElement | null;
const repoInput = document.getElementById("repo-input") as HTMLInputElement | null;
const checkError = document.getElementById("check-error") as HTMLElement | null;
const checkErrorText = document.getElementById("check-error-text") as HTMLElement | null;
const checkNote = document.getElementById("check-note") as HTMLElement | null;
const terminalCard = document.getElementById("terminal-card") as HTMLElement | null;

let state: "empty" | "working" | "result" = "empty";
let currentProgress: string[] = [];
let lastResult: CheckResult | null = null;
let lastFixes: FixesPayload | null = null;
let isWaitingForFixes = false;
let lastRecord: RecordPayload | null = null;
const openDetailsKeys = new Set<string>();
let isStreamOpen = false;
let stopStepSpy: () => void = () => {};
let hasEntered = false;

function showSavedCheck(): boolean {
  const el = document.getElementById("saved-check");
  if (!el) return false;
  const raw = el.dataset.check ?? "";
  if (!raw.trim()) return false;
  try {
    const data = JSON.parse(raw) as { result: CheckResult; fixes: FixesPayload; record: RecordPayload };
    lastResult = data.result;
    lastFixes = data.fixes;
    lastRecord = data.record;
    isWaitingForFixes = false;
    isStreamOpen = false;
    state = "result";
    render();
    return true;
  } catch {
    return false;
  }
}

function markFixesLost(): void {
  if (lastResult && lastFixes == null) {
    lastFixes = { files: [], summary: "", muse: "lost" };
    isWaitingForFixes = false;
    render();
  }
}

function maybeUpdateUrl(inputText: string): void {
  const repo = repoFromInput(inputText);
  if (repo) {
    const next = "?repo=" + encodeURIComponent(repo);
    try {
      history.replaceState(null, "", next);
    } catch {}
  }
}

function showError(message: string): void {
  const { text, command } = splitErrorCommand(message);
  if (checkErrorText) checkErrorText.textContent = text;
  if (checkError) {
    for (const child of Array.from(checkError.children)) {
      if (child.id !== "check-error-text") child.remove();
    }
    if (command) {
      const box = createCommandBox(command);
      checkError.appendChild(box);
      if (terminalCard) terminalCard.hidden = true;
    }
    checkError.hidden = false;
  }
  if (checkForm) checkForm.classList.add("has-error");
  if (checkNote) checkNote.hidden = true;
  if (repoInput) repoInput.focus();
}

function clearError(): void {
  if (checkErrorText) checkErrorText.textContent = "";
  if (checkError) {
    for (const child of Array.from(checkError.children)) {
      if (child.id !== "check-error-text") child.remove();
    }
    checkError.hidden = true;
  }
  if (checkForm) checkForm.classList.remove("has-error");
  if (checkNote) checkNote.hidden = false;
  if (terminalCard) terminalCard.hidden = false;
}

function render(): void {
  if (appEl) captureDetailsState(appEl, openDetailsKeys);
  stopStepSpy();
  if (!appEl) return;
  while (appEl.firstChild) appEl.removeChild(appEl.firstChild);
  if (state === "empty") {
    if (landingEl) landingEl.hidden = false;
    if (appEl) appEl.hidden = true;
    appEl.dataset.state = "empty";
    return;
  }
  if (state === "working") {
    if (landingEl) landingEl.hidden = true;
    if (appEl) appEl.hidden = false;
    const rawUrl = repoInput ? repoInput.value.trim() : "";
    const repoName = repoFromInput(rawUrl) ?? (rawUrl || "");
    appEl.appendChild(renderWorking({ repoName, progress: currentProgress }));
    const wasWorking = appEl.dataset.state === "working";
    if (!wasWorking) window.scrollTo(0, 0);
    appEl.dataset.state = "working";
    return;
  }
  if (state === "result" && lastResult) {
    if (landingEl) landingEl.hidden = true;
    if (appEl) appEl.hidden = false;
    const isEntering = !hasEntered;
    if (isEntering) window.scrollTo(0, 0);
    hasEntered = true;
    const vm = viewModel(lastResult);
    const plan = resultPlan(lastResult, lastFixes, isWaitingForFixes);
    appEl.appendChild(renderSummary({ lastResult, vm, plan, lastFixes, isEntering }));
    const numberedSections: HTMLElement[] = [];
    const numberedNavItems: { id: string; stepNumber: number; title: string }[] = [];
    const unnumberedSections: HTMLElement[] = [];
    const unnumberedNavItems: { id: string; stepNumber: number; title: string }[] = [];
    const clean = (s: string): string => s.replaceAll("`", "");
    let stepCounter = 1;
    const order = (plan as unknown as { stepOrder?: string[] }).stepOrder ?? [];
    for (const key of order) {
      let section: HTMLElement | null = null;
      let title = "";
      if (key === "files") {
        section = renderFilesSection({ plan, lastFixes, lastResult, stepNumber: stepCounter });
        title = clean((plan as unknown as { filesTitle: string }).filesTitle);
      } else if (key === "install") {
        section = renderInstallSection(plan, stepCounter);
        title = "Install yokoten";
      } else if (key === "hand") {
        section = renderHandSection(plan, stepCounter);
        title = clean((plan as unknown as { handTitle: string }).handTitle);
      }
      if (section) {
        numberedSections.push(section);
        numberedNavItems.push({ id: section.id, stepNumber: stepCounter, title });
        stepCounter++;
      }
    }
    const filesBlock = (plan as unknown as { filesBlock?: unknown }).filesBlock;
    const filesAreStep = (plan as unknown as { filesAreStep?: boolean }).filesAreStep;
    const isFilesHidden = filesBlock === "hidden" || (typeof filesBlock === "object" && filesBlock !== null && (filesBlock as { hidden?: boolean }).hidden === true);
    if (!isFilesHidden && filesAreStep === false) {
      const sec = renderFilesSection({ plan, lastFixes, lastResult, stepNumber: 0 });
      if (sec) {
        unnumberedSections.push(sec);
        unnumberedNavItems.push({ id: sec.id, stepNumber: 0, title: clean((plan as unknown as { filesTitle: string }).filesTitle) });
      }
    }
    const priv = renderPrivateSection({ vm });
    if (priv) {
      unnumberedSections.push(priv);
      unnumberedNavItems.push({ id: priv.id, stepNumber: 0, title: "Is this meant to be public?" });
    }
    if (lastRecord !== null || isStreamOpen === false) {
      const proof = renderProofSection({ vm, lastRecord });
      unnumberedSections.push(proof);
      unnumberedNavItems.push({ id: proof.id, stepNumber: 0, title: proofNavTitle(lastRecord) });
    }
    const navItems = [...numberedNavItems, ...unnumberedNavItems];
    if (navItems.length > 0) {
      const { rail, bar } = renderStepNav(navItems);
      const zoneSteps = make("div", "zone-steps");
      zoneSteps.appendChild(bar);
      const grid = make("div", "steps-grid");
      grid.appendChild(rail);
      const stepsContainer = make("div");
      stepsContainer.setAttribute("data-steps", "");
      for (const s of numberedSections) stepsContainer.appendChild(s);
      if (numberedSections.length > 0) {
        const ownerVal = (lastResult as unknown as { owner?: string }).owner ?? "";
        const repoVal = (lastResult as unknown as { repo?: string }).repo ?? "";
        let finalOwner = ownerVal;
        let finalRepo = repoVal;
        const maybe = repoFromInput(repoInput ? repoInput.value.trim() : "");
        if (maybe && maybe.includes("/")) {
          const parts = maybe.split("/");
          if (!finalOwner) finalOwner = parts[0];
          if (!finalRepo) finalRepo = parts[1];
        }
        if ((!finalOwner || !finalRepo) && typeof repoVal === "string" && repoVal.includes("/")) {
          const parts = repoVal.split("/");
          if (!finalOwner) finalOwner = parts[0];
          if (!finalRepo) finalRepo = parts[1];
        }
        const closeSec = make("section", "close");
        const h2 = make("h2", undefined, "Made the changes?");
        const p = make("p", undefined, "Run the check again to see the new count.");
        const a = make("a", "btn btn-primary ctl", "Run it again");
        a.setAttribute("href", rerunHref(finalOwner, finalRepo));
        closeSec.appendChild(h2);
        closeSec.appendChild(p);
        closeSec.appendChild(a);
        stepsContainer.appendChild(closeSec);
      }
      if (unnumberedSections.length > 0) {
        const zonesAfter = make("div", "zones-after");
        for (const s of unnumberedSections) zonesAfter.appendChild(s);
        stepsContainer.appendChild(zonesAfter);
      }
      grid.appendChild(stepsContainer);
      zoneSteps.appendChild(grid);
      appEl.appendChild(zoneSteps);
    }
    appEl.dataset.state = "result";
    restoreDetailsState(appEl, openDetailsKeys);
    stopStepSpy = startStepSpy(appEl);
    if (isEntering && location.hash.startsWith("#check-")) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) {
        if (target.tagName.toLowerCase() === "details") {
          (target as HTMLDetailsElement).open = true;
          const allChecks = document.querySelector('details[data-key="all-checks"]') as HTMLDetailsElement | null;
          if (allChecks) allChecks.open = true;
        }
        target.scrollIntoView();
      }
    }
  }
}

async function startCheck(): Promise<void> {
  hasEntered = false;
  clearOpenedFiles();
  isStreamOpen = true;
  if (appEl) appEl.dataset.rendered = "";
  clearError();
  const url = repoInput ? repoInput.value.trim() : "";
  if (!url) {
    const msg = "That doesn't look like a public GitHub repo. Try https://github.com/owner/repo.";
    isStreamOpen = false;
    state = "empty";
    render();
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    showError(msg);
    return;
  }
  maybeUpdateUrl(url);
  state = "working";
  currentProgress = [];
  lastResult = null;
  lastFixes = null;
  lastRecord = null;
  isWaitingForFixes = false;
  openDetailsKeys.clear();
  render();
  try {
    const resp = await fetch(API + "/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok && !resp.body) throw new Error("network");
    const reader = resp.body ? resp.body.getReader() : null;
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let buffer = "";
    let hasResultOrError = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!raw.trim()) continue;
        let eventName = "";
        let dataStr = "";
        const lines = raw.split("\n");
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
        }
        if (!eventName) continue;
        let data: unknown = null;
        try { data = JSON.parse(dataStr); } catch { data = {}; }
        if (eventName === "progress") {
          const d = data as Record<string, unknown>;
          const step = d.step as string | undefined;
          if (step) { currentProgress.push(step); render(); }
        } else if (eventName === "result") {
          hasResultOrError = true;
          lastResult = data as CheckResult;
          state = "result";
          isWaitingForFixes = true;
          render();
        } else if (eventName === "fixes") {
          if (!lastResult) continue;
          lastFixes = data as FixesPayload;
          isWaitingForFixes = false;
          render();
        } else if (eventName === "record") {
          lastRecord = data as RecordPayload;
          render();
        } else if (eventName === "error") {
          hasResultOrError = true;
          const d = data as Record<string, unknown>;
          const msg = typeof d.message === "string" ? d.message : "The check couldn't finish. Try again in a minute.";
          isStreamOpen = false;
          state = "empty";
          render();
          showError(msg);
        }
      }
    }
    if (!hasResultOrError) {
      const msg = "The connection dropped. Try again.";
      isStreamOpen = false;
      state = "empty";
      render();
      showError(msg);
    } else {
      isStreamOpen = false;
      markFixesLost();
      render();
    }
  } catch (_e) {
    if (lastResult) { isStreamOpen = false; markFixesLost(); render(); return; }
    const msg = "The connection dropped. Try again.";
    isStreamOpen = false;
    state = "empty";
    render();
    showError(msg);
  }
}

if (checkForm) {
  checkForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void startCheck();
  });
}
if (repoInput) repoInput.addEventListener("input", () => clearError());

render();

try {
  const fromQ = showSavedCheck() ? null : repoFromQuery(window.location.search);
  if (fromQ) {
    const full = "https://github.com/" + fromQ;
    if (repoInput) repoInput.value = full;
    void startCheck();
  }
} catch {}
