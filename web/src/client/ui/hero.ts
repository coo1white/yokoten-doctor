import { toSentence } from "../view.ts";
import { rerunHref } from "../fixes.ts";
import type { CheckResult, ViewModel, ResultPlan, FixesPayload } from "../types.ts";
import { createIcon, make, renderRichText } from "./dom.ts";
import { renderAllChecks } from "./checks.ts";

export function renderSummary({ lastResult, vm, plan, lastFixes, isEntering }: { lastResult: CheckResult; vm: ViewModel; plan: ResultPlan; lastFixes: FixesPayload | null; isEntering: boolean }): HTMLElement {
  const outer = make("section", "zone-sum");
  const inner = make("div", "sum-in");
  outer.appendChild(inner);
  const state = make("div", isEntering ? "enter" : undefined);
  renderHead(state, lastResult, lastFixes);
  renderStats(state, vm, plan, isEntering);
  inner.appendChild(state);
  renderNext(inner, vm, plan);
  const all = make("div", "sum-all");
  const checks = renderAllChecks(lastResult, vm, plan);
  all.appendChild(checks);
  inner.appendChild(all);
  return outer;
}

function renderHead(parent: HTMLElement, result: CheckResult, fixes: FixesPayload | null): void {
  const owner = result.owner ?? "";
  const repo = result.repo ?? "";
  const header = make("div", "r-head");
  const title = make("h1", "r-repo");
  const link = make("a");
  link.href = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  link.appendChild(document.createTextNode(owner));
  link.appendChild(document.createTextNode("/"));
  link.appendChild(document.createElement("wbr"));
  link.appendChild(document.createTextNode(repo));
  title.appendChild(link);
  header.appendChild(title);
  const tools = make("div", "r-tools");
  const saved = document.getElementById("saved-check");
  if (saved instanceof HTMLElement) {
    const value = saved.dataset.saved;
    if (value) {
      const label = make("span", undefined, `Saved ${value}`);
      tools.appendChild(label);
      const rerun = make("a", "link ctl");
      rerun.href = rerunHref(owner, repo);
      rerun.textContent = "Run it again";
      tools.appendChild(rerun);
    }
  }
  const copy = make("button", "link ctl", "Copy link");
  copy.type = "button";
  copy.setAttribute("data-copy-url", "");
  tools.appendChild(copy);
  header.appendChild(tools);
  parent.appendChild(header);
  const summary = fixes?.summary?.trim() ?? "";
  if (summary !== "") {
    const about = make("p", "r-about");
    about.appendChild(document.createTextNode(summary));
    about.appendChild(document.createTextNode(" "));
    const by = make("span", undefined, "Summary by Muse.");
    about.appendChild(by);
    parent.appendChild(about);
  }
}

function renderStats(parent: HTMLElement, vm: ViewModel, plan: ResultPlan, isEntering: boolean): void {
  const done = plan.done;
  const total = plan.total;
  const count = make("p", "count");
  const bold = make("b", undefined, String(done));
  count.appendChild(bold);
  const label = make("span", undefined, `of ${total} file checks pass`);
  count.appendChild(label);
  parent.appendChild(count);
  renderBar(parent, vm, plan, isEntering);
  renderLegend(parent, plan);
  const note = make("p", "count-note", "These checks read files. They don't judge your code.");
  parent.appendChild(note);
}

function renderBar(parent: HTMLElement, vm: ViewModel, plan: ResultPlan, isEntering: boolean): void {
  const bar = make("div", isEntering ? "bar bar-anim" : "bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", vm.score.text);
  for (const segment of plan.segments) {
    const part = make("i", segment ? segment : undefined);
    bar.appendChild(part);
  }
  parent.appendChild(bar);
}

function renderLegend(parent: HTMLElement, plan: ResultPlan): void {
  if (plan.legend.length === 0) return;
  const list = make("ul", "legend");
  for (const entry of plan.legend) {
    const item = make("li");
    const swatch = make("span", `swatch ${entry.swatch}`);
    swatch.setAttribute("aria-hidden", "true");
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(entry.text));
    list.appendChild(item);
  }
  parent.appendChild(list);
}

function renderNext(parent: HTMLElement, vm: ViewModel, plan: ResultPlan): void {
  const next = vm.next;
  if (!next) {
    renderNextEmpty(parent, plan);
    return;
  }
  renderNextCard(parent, next, plan);
}

function renderNextEmpty(parent: HTMLElement, plan: ResultPlan): void {
  const section = make("section", "next");
  const label = make("p", "next-label", "Nothing to fix");
  section.appendChild(label);
  const heading = make("h2", undefined, `All ${plan.total} file checks pass.`);
  section.appendChild(heading);
  parent.appendChild(section);
}

function renderNextCard(parent: HTMLElement, next: NonNullable<ViewModel["next"]>, plan: ResultPlan): void {
  const section = make("section", "next");
  section.setAttribute("aria-labelledby", "next-title");
  const label = make("p", "next-label", "Do this first");
  section.appendChild(label);
  const title = make("h2");
  title.id = "next-title";
  renderRichText(next.title, title);
  section.appendChild(title);
  const why = getWhyText(next);
  if (why !== "") {
    const para = make("p", "next-why");
    renderRichText(why, para);
    section.appendChild(para);
  }
  const action = plan.action;
  if (action) {
    const link = buildActionLink(action);
    section.appendChild(link);
  }
  parent.appendChild(section);
}

function getWhyText(next: NonNullable<ViewModel["next"]>): string {
  if (next.id === "issues") return "Turn on issues in the repo's settings on GitHub.";
  const raw = next.why ?? "";
  if (raw === "") return "";
  return toSentence(raw);
}

function buildActionLink(action: NonNullable<ResultPlan["action"]>): HTMLAnchorElement {
  const link = make("a", action.isQuiet ? "btn btn-line ctl" : "btn btn-primary ctl");
  link.href = action.href;
  link.textContent = action.label;
  if (action.href.startsWith("https://")) {
    link.target = "_blank";
    link.rel = "noopener";
    const icon = createIcon("out");
    link.appendChild(icon);
  }
  if (action.opensChart) {
    link.addEventListener("click", () => {
      const all = document.querySelector<HTMLDetailsElement>('details[data-key="all-checks"]');
      if (all) all.open = true;
      if (action.href.startsWith("#")) {
        const id = action.href.slice(1);
        const target = document.getElementById(id);
        if (target instanceof HTMLDetailsElement) target.open = true;
      }
    });
  }
  return link;
}
