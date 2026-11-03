const API = "https://yokoten-doctor--yokoten-doctor-fastapi-app.us-east.modal.run";

import { viewModel, repoFromInput, repoFromQuery, splitErrorCommand, resultScreen } from "./view.ts";
import { createCommandBox, captureDetailsState, restoreDetailsState } from "./ui/dom.ts";
import { renderWorking } from "./ui/working.ts";
import { renderResultPage, clearStepProgress } from "./ui/page.ts";
import type { CheckResult, FixesPayload, RecordPayload } from "./types.ts";

const appEl = document.getElementById("app");
const landingEl = document.getElementById("landing");
const checkFormCandidate = document.getElementById("check-form");
const checkForm = checkFormCandidate instanceof HTMLFormElement ? checkFormCandidate : null;
const repoInputCandidate = document.getElementById("repo-input");
const repoInput = repoInputCandidate instanceof HTMLInputElement ? repoInputCandidate : null;
const checkError = document.getElementById("check-error");
const checkErrorText = document.getElementById("check-error-text");
const checkNote = document.getElementById("check-note");
const terminalCard = document.getElementById("terminal-card");
const isExample = document.getElementById("saved-check") !== null;
let isSavedCheck = new URLSearchParams(window.location.search).get("saved") === "1";

let state: "empty" | "working" | "result" = "empty";
let currentProgress: string[] = [];
let lastResult: CheckResult | null = null;
let lastFixes: FixesPayload | null = null;
let isWaitingForFixes = false;
let lastRecord: RecordPayload | null = null;
const openDetailsKeys = new Set<string>();
let isStreamOpen = false;
let hasEntered = false;
let lastShownState = "";

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
    const next = "?repo=" + encodeURIComponent(repo) + (isSavedCheck ? "&saved=1" : "");
    try {
      history.replaceState(null, "", next);
    } catch {}
  }
}

function removeOldCommandBox(): void {
  if (!checkError) return;
  for (const child of Array.from(checkError.children)) {
    if (child.id !== "check-error-text") child.remove();
  }
}

function showError(message: string): void {
  const { text, command } = splitErrorCommand(message);
  if (checkErrorText) checkErrorText.textContent = text;
  if (checkError) {
    removeOldCommandBox();
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
    removeOldCommandBox();
    checkError.hidden = true;
  }
  if (checkForm) checkForm.classList.remove("has-error");
  if (checkNote) checkNote.hidden = false;
  if (terminalCard) terminalCard.hidden = false;
}

function getCheckUrl(): string | null {
  const url = repoInput ? repoInput.value.trim() : "";
  if (!url) {
    const msg = "That doesn't look like a public GitHub repo. Try https://github.com/owner/repo.";
    isStreamOpen = false;
    state = "empty";
    render();
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    showError(msg);
    return null;
  }
  return url;
}

function resetCheckState(): void {
  state = "working";
  currentProgress = [];
  lastResult = null;
  lastFixes = null;
  lastRecord = null;
  isWaitingForFixes = false;
  openDetailsKeys.clear();
}

async function getReader(url: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const resp = await fetch(API + "/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  if (!resp.ok && !resp.body) throw new Error("network");
  const reader = resp.body ? resp.body.getReader() : null;
  if (!reader) throw new Error("no body");
  return reader;
}

function handleCheckError(message: string): void {
  isStreamOpen = false;
  state = "empty";
  render();
  showError(message);
}

function render(): void {
  if (appEl) captureDetailsState(appEl, openDetailsKeys);
  if (!appEl) return;
  while (appEl.firstChild) appEl.removeChild(appEl.firstChild);
  if (state === "empty") {
    if (landingEl) landingEl.hidden = false;
    appEl.hidden = true;
    lastShownState = "empty";
    return;
  }
  if (state === "working") {
    if (landingEl) landingEl.hidden = true;
    appEl.hidden = false;
    const rawUrl = repoInput ? repoInput.value.trim() : "";
    const repoName = repoFromInput(rawUrl) ?? (rawUrl || "");
    appEl.appendChild(renderWorking({ repoName, progress: currentProgress }));
    if (lastShownState !== "working") window.scrollTo(0, 0);
    lastShownState = "working";
    return;
  }
  if (state === "result" && lastResult) renderResult();
}

function renderResult(): void {
  if (!appEl || !lastResult) return;
  if (landingEl) landingEl.hidden = true;
  appEl.hidden = false;
  const isEntering = !hasEntered;
  if (isEntering) window.scrollTo(0, 0);
  hasEntered = true;
  const vm = viewModel(lastResult);
  const screen = resultScreen(lastResult, lastFixes, isSavedCheck && !isExample);
  const onBackToSteps = (): void => {
    isSavedCheck = false;
    if (repoInput) maybeUpdateUrl(repoInput.value);
    else if (lastResult && lastResult.owner && lastResult.repo) maybeUpdateUrl(lastResult.owner + "/" + lastResult.repo);
    render();
    window.scrollTo(0, 0);
  };
  appEl.appendChild(renderResultPage({ lastResult, vm, screen, lastFixes, lastRecord, isRecordShown: lastRecord !== null || isStreamOpen === false, isEntering, isExample, isSavedCheck: isSavedCheck && !isExample, onBackToSteps }));
  lastShownState = "result";
  restoreDetailsState(appEl, openDetailsKeys);
  if (isEntering) openCheckFromHash();
}

function openCheckFromHash(): void {
  if (!location.hash.startsWith("#check-")) return;
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
    const allChecks = document.querySelector<HTMLDetailsElement>('details[data-key="all-checks"]');
    if (allChecks) allChecks.open = true;
  }
  target.scrollIntoView();
}

async function startCheck(): Promise<void> {
  hasEntered = false;
  clearStepProgress();
  isStreamOpen = true;
  clearError();
  const url = getCheckUrl();
  if (!url) return;
  maybeUpdateUrl(url);
  resetCheckState();
  render();
  try {
    const reader = await getReader(url);
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
    if (!hasResultOrError) handleCheckError("The connection dropped. Try again.");
    else {
      isStreamOpen = false;
      markFixesLost();
      render();
    }
  } catch (_e) {
    if (lastResult) {
      isStreamOpen = false;
      markFixesLost();
      render();
      return;
    }
    handleCheckError("The connection dropped. Try again.");
  }
}

if (checkForm) {
  checkForm.addEventListener("submit", (e) => {
    e.preventDefault();
    isSavedCheck = false;
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
