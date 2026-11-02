const API = "https://yokoten-doctor--yokoten-doctor-fastapi-app.us-east.modal.run";

import { viewModel, repoFromInput, repoFromQuery } from "./view.ts";
import { renderResultHero } from "./ui/hero.ts";
import { renderPrivateSection } from "./ui/private.ts";
import { renderFixSection, renderGuardSection } from "./ui/fix.ts";
import { renderProofSection } from "./ui/proof.ts";
import { captureDetailsState, restoreDetailsState } from "./ui/dom.ts";
import { renderWorking } from "./ui/working.ts";
import type { CheckResult, FixesPayload, RecordPayload } from "./types.ts";

const appEl = document.getElementById("app") as HTMLElement | null;
const landingEl = document.getElementById("landing") as HTMLElement | null;
const checkForm = document.getElementById("check-form") as HTMLFormElement | null;
const repoInput = document.getElementById("repo-input") as HTMLInputElement | null;
const checkError = document.getElementById("check-error") as HTMLParagraphElement | null;
const heroLive = document.getElementById("hero-live") as HTMLElement | null;
const checkButton = checkForm ? checkForm.querySelector("button[type=\"submit\"]") as HTMLButtonElement | null : null;

let state: "empty" | "working" | "result" = "empty";
let currentProgress: string[] = [];
let lastResult: CheckResult | null = null;
let lastFixes: FixesPayload | null = null;
let isWaitingForFixes = false;
let lastRecord: RecordPayload | null = null;

const openDetailsKeys = new Set<string>();

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

function restoreEmptyState(): void {
  if (landingEl) landingEl.hidden = false;
  if (appEl) appEl.hidden = true;
  if (heroLive) {
    heroLive.hidden = true;
    while (heroLive.firstChild) heroLive.removeChild(heroLive.firstChild);
  }
  if (repoInput) repoInput.readOnly = false;
  if (checkButton) {
    checkButton.disabled = false;
    checkButton.textContent = "Check";
  }
}

function enterWorkingState(): void {
  if (landingEl) landingEl.hidden = false;
  if (appEl) appEl.hidden = true;
  if (heroLive) heroLive.hidden = false;
  if (repoInput) repoInput.readOnly = true;
  if (checkButton) {
    checkButton.disabled = true;
    checkButton.textContent = "Checking…";
  }
}

function renderWorkingIntoHero(): void {
  if (!heroLive) return;
  while (heroLive.firstChild) heroLive.removeChild(heroLive.firstChild);
  const rawUrl = repoInput ? repoInput.value.trim() : "";
  const repoName = repoFromInput(rawUrl) ?? (rawUrl || "");
  const terminal = renderWorking({ repoName, progress: currentProgress });
  heroLive.appendChild(terminal);
  const note = document.createElement("p");
  note.className = "hero-live-note";
  note.textContent = "Usually about 15 seconds.";
  heroLive.appendChild(note);
}

function showError(message: string): void {
  if (checkError) {
    checkError.textContent = message;
    checkError.hidden = false;
  }
  if (repoInput) repoInput.focus();
}

function clearError(): void {
  if (checkError) {
    checkError.textContent = "";
    checkError.hidden = true;
  }
}

function render(): void {
  if (appEl) captureDetailsState(appEl, openDetailsKeys);
  if (!appEl) return;
  while (appEl.firstChild) appEl.removeChild(appEl.firstChild);

  if (state === "empty") {
    restoreEmptyState();
    return;
  }

  if (state === "working") {
    enterWorkingState();
    renderWorkingIntoHero();
    return;
  }

  if (state === "result" && lastResult) {
    if (landingEl) landingEl.hidden = true;
    if (appEl) appEl.hidden = false;
    if (heroLive) {
      heroLive.hidden = true;
      while (heroLive.firstChild) heroLive.removeChild(heroLive.firstChild);
    }
    if (repoInput) repoInput.readOnly = false;
    if (checkButton) {
      checkButton.disabled = false;
      checkButton.textContent = "Check";
    }
    window.scrollTo(0, 0);
    appEl.classList.toggle("is-entering", appEl.dataset.rendered !== "result");
    appEl.dataset.rendered = "result";
    const vm = viewModel(lastResult);
    const hero = renderResultHero({ lastResult, vm, lastFixes, isWaitingForFixes });
    appEl.appendChild(hero);
    const fix = renderFixSection({ vm, lastFixes, isWaitingForFixes, lastResult });
    if (fix) appEl.appendChild(fix);
    const guard = renderGuardSection({ vm });
    if (guard) appEl.appendChild(guard);
    const priv = renderPrivateSection({ vm });
    if (priv) appEl.appendChild(priv);
    const proof = renderProofSection({ vm, lastRecord });
    appEl.appendChild(proof);
  }

  restoreDetailsState(appEl, openDetailsKeys);
}

async function startCheck(): Promise<void> {
  if (appEl) appEl.dataset.rendered = "";
  clearError();
  const url = repoInput ? repoInput.value.trim() : "";
  if (!url) {
    const msg = "That doesn't look like a public GitHub repo. Try https://github.com/owner/repo.";
    state = "empty";
    render();
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
          state = "empty";
          render();
          showError(msg);
        }
      }
    }
    if (!hasResultOrError) {
      const msg = "The connection dropped. Try again.";
      state = "empty";
      render();
      showError(msg);
    } else {
      markFixesLost();
    }
  } catch (_e) {
    if (lastResult) { markFixesLost(); return; }
    const msg = "The connection dropped. Try again.";
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

render();

try {
  const fromQ = showSavedCheck() ? null : repoFromQuery(window.location.search);
  if (fromQ) {
    const full = "https://github.com/" + fromQ;
    if (repoInput) repoInput.value = full;
    void startCheck();
  }
} catch {}
