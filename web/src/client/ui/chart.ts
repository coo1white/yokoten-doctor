import { createLink, createPanel, renderRichText } from "./dom.ts";
import { shownMark, toSentence } from "../view.ts";
import type { CheckResult, ViewModel } from "../types.ts";

export function renderChart({ lastResult, vm }: { lastResult: CheckResult; vm: ViewModel }): HTMLElement {
  const { panel, body } = createPanel(`All ${vm.score.total} checks`);

  const list = document.createElement("div");
  list.className = "result-chart";
  list.setAttribute("role", "list");
  const steps = (lastResult.summary as { steps?: { id: string; title: string; mark: string }[] } | undefined)?.steps ?? [];
  for (const s of steps) {
    const row = document.createElement("div");
    row.setAttribute("role", "listitem");
    row.className = "chart-row";
    const m = shownMark(s.mark, s.id, vm.next ? vm.next.id : null);
    if (m === "done") row.classList.add("is-done");
    else if (m === "next") row.classList.add("is-next");
    else row.classList.add("is-todo");

    const box = document.createElement("span");
    box.className = "chart-box";
    box.setAttribute("aria-hidden", "true");
    row.appendChild(box);

    const markEl = document.createElement("span");
    markEl.className = "chart-mark";
    if (m === "done") markEl.textContent = "done";
    else if (m === "next") markEl.textContent = "next";
    else if (vm.installOnly.some((step) => step.id === s.id)) markEl.textContent = "install";
    else markEl.textContent = "to do";
    row.appendChild(markEl);

    const titleEl = document.createElement("span");
    titleEl.className = "chart-title";
    titleEl.textContent = s.title;
    row.appendChild(titleEl);

    list.appendChild(row);
  }
  body.appendChild(list);

  const detailsAll = document.createElement("details");
  detailsAll.setAttribute("data-key", "show-all-checks");
  detailsAll.className = "show-all-checks";
  const sumAll = document.createElement("summary");
  sumAll.textContent = "Details for every check";
  detailsAll.appendChild(sumAll);

  const checkDetails = document.createElement("div");
  checkDetails.className = "check-details";

  const items = vm.next ? [{ ...vm.next, label: "fix this first" }, ...vm.others] : vm.others;
  for (const st of items) {
    const stWrap = document.createElement("div");
    stWrap.className = "check-item";
    stWrap.id = `check-${st.id}`;

    const titleP = document.createElement("p");
    titleP.className = "check-item-title";
    titleP.appendChild(document.createTextNode(st.title));
    titleP.appendChild(document.createTextNode(" "));
    const idSpan = document.createElement("span");
    idSpan.className = "check-item-id";
    idSpan.textContent = `${st.id} · ${st.label}`;
    titleP.appendChild(idSpan);
    stWrap.appendChild(titleP);

    const fields: [string, string | undefined][] = [
      ["What we found.", st.what],
      ["Why it matters.", st.why],
      ["How to fix it.", st.fix],
    ];
    for (const [lead, value] of fields) {
      if (value == null || value === "") continue;
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = lead;
      p.appendChild(strong);
      p.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      renderRichText(toSentence(value), span);
      p.appendChild(span);
      stWrap.appendChild(p);
    }

    if (st.docs) {
      const docsP = document.createElement("p");
      const link = createLink(st.docs, st.docs);
      docsP.appendChild(link);
      stWrap.appendChild(docsP);
    }

    if (st.how) {
      const detHow = document.createElement("details");
      detHow.setAttribute("data-key", "how-" + st.id);
      const sumHow = document.createElement("summary");
      sumHow.textContent = "How this was judged";
      detHow.appendChild(sumHow);
      const howP = document.createElement("p");
      renderRichText(st.how, howP);
      detHow.appendChild(howP);
      stWrap.appendChild(detHow);
    }

    checkDetails.appendChild(stWrap);
  }

  detailsAll.appendChild(checkDetails);
  body.appendChild(detailsAll);

  return panel;
}
