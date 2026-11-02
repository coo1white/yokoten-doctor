import { toSentence, shownMark, markLabel } from "../view.ts";
import { createFold, createIcon, createLink, make, renderRichText } from "./dom.ts";
import type { IconName } from "./dom.ts";
import type { CheckResult, ViewModel, ResultPlan, SummaryStep } from "../types.ts";

export function renderAllChecks(result: CheckResult, viewModel: ViewModel, plan: ResultPlan): HTMLElement {
  const installIds = new Set(plan.installSteps.map((step) => step.id));
  const steps = result.summary?.steps ?? [];
  const total = plan.total;
  const container = make("div", "checks");
  for (const step of steps) {
    const row = buildRow(step, viewModel, installIds);
    container.appendChild(row);
  }
  const outer = createFold(`See all ${total} checks`, [container], { key: "all-checks" });
  const section = make("section", "plan");
  section.setAttribute("aria-label", "All checks");
  section.appendChild(outer);
  return section;
}

function buildRow(step: SummaryStep, viewModel: ViewModel, installIds: Set<string>): HTMLDetailsElement {
  const id = step.id;
  const isDone = step.mark === "done";
  const nextId = viewModel.next?.id ?? null;
  const isNext = shownMark(step.mark, id, nextId) === "next";
  const rowClass = "ck" + (isDone ? " is-done" : "") + (isNext ? " ck-next" : "");
  const tag = getTag(step, isDone, isNext, installIds);
  const title = buildTitle(step, tag, isDone, isNext);
  const body = buildBody(step, id);
  return createFold(title, body, { key: "check-" + id, id: "check-" + id, className: rowClass });
}

function getTag(step: SummaryStep, isDone: boolean, isNext: boolean, installIds: Set<string>): string {
  if (isDone) return "";
  if (isNext) return "do this first";
  if (installIds.has(step.id)) return "needs yokoten";
  const reason = step.reason ?? "";
  return markLabel(step.mark, reason);
}

function buildTitle(step: SummaryStep, tag: string, isDone: boolean, isNext: boolean): Node[] {
  const mark = make("span", "ck-mark");
  const iconName = getIconName(isDone, isNext);
  const icon = createIcon(iconName);
  mark.appendChild(icon);
  const title = make("span", "ck-title");
  renderRichText(step.title, title);
  const nodes: Node[] = [mark, title];
  if (tag !== "") {
    const tagWrap = make("span", "ck-tag", tag);
    nodes.push(tagWrap);
  }
  return nodes;
}

function getIconName(isDone: boolean, isNext: boolean): IconName {
  if (isDone) return "check";
  if (isNext) return "dot";
  return "circle";
}

function buildBody(step: SummaryStep, id: string): Node[] {
  const body: Node[] = [];
  const fields: Array<[string, string | undefined]> = [
    ["What we found.", step.what],
    ["Why it matters.", step.why],
    ["How to fix it.", step.fix],
  ];
  for (const [lead, value] of fields) {
    if (!value) continue;
    const para = make("p", "ck-field");
    const bold = make("b", undefined, lead);
    para.appendChild(bold);
    para.appendChild(document.createTextNode(" "));
    renderRichText(toSentence(value), para);
    body.push(para);
  }
  if (step.docs) {
    const docs = make("p", "ck-field");
    const link = createLink(step.docs, step.docs);
    docs.appendChild(link);
    body.push(docs);
  }
  if (step.how) {
    const how = make("p", "ck-field muted");
    renderRichText(step.how, how);
    const fold = createFold("How this was judged", [how], { key: "how-" + id });
    body.push(fold);
  }
  return body;
}
