import { toSentence, nextAction } from "../view.ts";
import { renderChart } from "./chart.ts";
import { rerunHref } from "../fixes.ts";
import type { CheckResult, FixesPayload, ViewModel } from "../types.ts";

export function renderResultHero({ lastResult, vm, lastFixes, isWaitingForFixes }: { lastResult: CheckResult; vm: ViewModel; lastFixes: FixesPayload | null; isWaitingForFixes?: boolean }): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-hero";
  section.id = "result-panel";

  const actions = document.createElement("div");
  actions.className = "result-actions";
  const saved = document.getElementById("saved-check")?.dataset.saved;
  if (saved) {
    const savedSpan = document.createElement("span");
    savedSpan.className = "result-saved";
    savedSpan.textContent = `Saved ${saved}`;
    actions.appendChild(savedSpan);
    const rerunLink = document.createElement("a");
    rerunLink.textContent = "Run it again";
    rerunLink.href = rerunHref(String(lastResult.owner ?? ""), String(lastResult.repo ?? ""));
    actions.appendChild(rerunLink);
  }
  const checkAnother = document.createElement("a");
  checkAnother.href = "/";
  checkAnother.textContent = "Check another repo";
  actions.appendChild(checkAnother);
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy link";
  const currentUrl = window.location.href;
  copyBtn.addEventListener("click", () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentUrl).then(() => {
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = "Copy link"; }, 2000);
      }).catch(() => {
        copyBtn.textContent = "Press Ctrl+C to copy";
      });
    } else {
      copyBtn.textContent = "Press Ctrl+C to copy";
    }
  });
  actions.appendChild(copyBtn);
  section.appendChild(actions);

  const grid = document.createElement("div");
  grid.className = "result-grid";

  const left = document.createElement("div");
  left.className = "result-hero-left";

  const h1 = document.createElement("h1");
  h1.className = "result-repo";
  h1.appendChild(document.createTextNode(`${lastResult.owner}/`));
  h1.appendChild(document.createElement("wbr"));
  h1.appendChild(document.createTextNode(`${lastResult.repo}`));
  left.appendChild(h1);

  if (lastFixes && lastFixes.summary && lastFixes.summary.trim() !== "") {
    const sumP = document.createElement("p");
    sumP.className = "result-summary";
    sumP.textContent = lastFixes.summary;
    left.appendChild(sumP);
    const small = document.createElement("p");
    small.className = "result-summary-note";
    small.textContent = "Summary by Muse.";
    left.appendChild(small);
  }

  const scoreWrap = document.createElement("div");
  scoreWrap.className = "score";
  const big = document.createElement("p");
  big.className = "score-big";
  const total = vm.score.total;
  const done = vm.score.done;
  big.appendChild(document.createTextNode(`${done} `));
  const span = document.createElement("span");
  span.textContent = `of ${total} file checks pass`;
  big.appendChild(span);
  scoreWrap.appendChild(big);

  const bar = document.createElement("div");
  bar.className = "score-bar";
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", vm.score.text);
  const segCount = vm.score.total || 0;
  bar.style.setProperty("--seg-count", String(segCount || 1));
  let afterDone: number | null = null;
  let afterTotal: number | null = null;
  let hasAfter = false;
  if (lastFixes && lastFixes.after && typeof lastFixes.after.done === "number" && typeof lastFixes.after.total === "number") {
    if (lastFixes.after.done > done) {
      hasAfter = true;
      afterDone = lastFixes.after.done;
      afterTotal = lastFixes.after.total;
    }
  }
  for (let i = 0; i < segCount; i++) {
    const seg = document.createElement("span");
    seg.className = "score-seg";
    if (i < done) seg.classList.add("is-done");
    else if (hasAfter && afterDone != null && i < afterDone) seg.classList.add("is-after");
    else seg.classList.add("is-open");
    bar.appendChild(seg);
  }
  scoreWrap.appendChild(bar);
  if (hasAfter && afterDone != null && afterTotal != null) {
    const afterP = document.createElement("p");
    afterP.className = "score-after";
    afterP.textContent = `${afterDone} of ${afterTotal} once you add the files below.`;
    scoreWrap.appendChild(afterP);
  }
  left.appendChild(scoreWrap);

  if (vm.next) {
    const nextWrap = document.createElement("div");
    nextWrap.className = "next-step";
    const label = document.createElement("p");
    label.className = "next-label";
    label.textContent = "Fix this first";
    nextWrap.appendChild(label);
    const h2 = document.createElement("h2");
    h2.className = "next-title";
    h2.textContent = vm.next.title;
    nextWrap.appendChild(h2);
    if (vm.next.id === "issues") {
      const whyP = document.createElement("p");
      whyP.className = "next-why";
      whyP.textContent = "Turn on issues in the repo's settings on GitHub.";
      nextWrap.appendChild(whyP);
    } else if (vm.next.why) {
      const whyP = document.createElement("p");
      whyP.className = "next-why";
      whyP.textContent = toSentence(vm.next.why);
      nextWrap.appendChild(whyP);
    }
    const owner = String(lastResult.owner ?? "");
    const repo = String(lastResult.repo ?? "");
    const act = nextAction(vm.next, vm.installOnly, lastFixes?.files ?? [], owner, repo, !!isWaitingForFixes);
    const fixLink = document.createElement("a");
    fixLink.href = act.href;
    fixLink.textContent = act.label;
    fixLink.className = "button-primary";
    if (act.href.startsWith("https://")) {
      fixLink.target = "_blank";
      fixLink.rel = "noopener";
    }
    if (act.opensChart) {
      fixLink.addEventListener("click", () => {
        const details = document.querySelector("details.show-all-checks") as HTMLDetailsElement | null;
        if (details) details.open = true;
      });
    }
    nextWrap.appendChild(fixLink);
    left.appendChild(nextWrap);
  } else if (vm.installOnly.length === 0 && done === total) {
    const doneP = document.createElement("p");
    doneP.className = "every-done";
    doneP.textContent = `All ${total} file checks pass.`;
    left.appendChild(doneP);
  }

  const right = document.createElement("div");
  right.className = "result-hero-right";
  right.appendChild(renderChart({ lastResult, vm }));

  grid.appendChild(left);
  grid.appendChild(right);
  section.appendChild(grid);

  return section;
}
