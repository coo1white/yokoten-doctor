import { toSentence, markLabel, OPTIONAL_CHECK_IDS } from "../view.ts";
import { createFold, createIcon, createLink, make, renderRichText, createRow } from "./dom.ts";
import type { IconName } from "./dom.ts";
import type { CheckResult, SummaryStep } from "../types.ts";

export function renderChecksRow(result: CheckResult): HTMLElement {
  const steps = result.summary?.steps ?? [];
  const filtered = steps.filter((s) => !OPTIONAL_CHECK_IDS.includes(s.id));
  const note = make("p", "small muted", "We only check whether these exist. That doesn't show they're any good, and none of this judges your code.");
  const container = make("div", "checks");
  for (const step of filtered) {
    const row = buildRow(step);
    container.appendChild(row);
  }
  return createRow("Files we looked for", "Not a grade", [note, container], { key: "all-checks" });
}

function buildRow(step: SummaryStep): HTMLDetailsElement {
  const id = step.id;
  const isDone = step.mark === "done";
  const rowClass = "ck" + (isDone ? " is-done" : "");
  const tag = getTag(step, isDone);
  const title = buildTitle(step, tag, isDone);
  const body = buildBody(step, id);
  return createFold(title, body, { key: "check-" + id, id: "check-" + id, className: rowClass });
}

function getTag(step: SummaryStep, isDone: boolean): string {
  if (isDone) return "";
  if (step.mark === "next" || step.mark === "to do") return "not found";
  const reason = step.reason ?? "";
  return markLabel(step.mark, reason);
}

function buildTitle(step: SummaryStep, tag: string, isDone: boolean): Node[] {
  const mark = make("span", "ck-mark");
  const iconName = getIconName(isDone);
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

function getIconName(isDone: boolean): IconName {
  if (isDone) return "check";
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
