import { renderRichText } from "./dom.ts";
import { secretFolders, toSentence } from "../view.ts";
import type { ViewModel } from "../types.ts";

export function renderPrivateSection({ vm }: { vm: ViewModel }): HTMLElement | null {
  if (!vm.secretCount || vm.secretCount === 0) return null;
  const section = document.createElement("section");
  section.className = "band private-section";
  const inner = document.createElement("div");
  inner.className = "band-inner";

  const label = document.createElement("p");
  label.className = "section-label";
  label.textContent = "Worth a look";
  inner.appendChild(label);

  const h2 = document.createElement("h2");
  h2.className = "section-title";
  if (vm.secretGroups.length === 1) h2.textContent = "1 thing looks private";
  else h2.textContent = `${vm.secretGroups.length} things look private`;
  inner.appendChild(h2);

  const note = document.createElement("p");
  note.className = "private-note";
  note.textContent = "Some of it may be public on purpose. That's your call.";
  inner.appendChild(note);

  const table = document.createElement("div");
  table.className = "private-table";
  table.setAttribute("role", "table");
  table.setAttribute("aria-label", "Things that look private");

  const head = document.createElement("div");
  head.className = "private-head";
  head.setAttribute("role", "row");
  for (const text of ["What", "Where", "What to do"]) {
    const span = document.createElement("span");
    span.setAttribute("role", "columnheader");
    span.textContent = text;
    head.appendChild(span);
  }
  table.appendChild(head);

  vm.secretGroups.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "private-row";
    row.setAttribute("role", "row");

    const cell1 = document.createElement("div");
    cell1.setAttribute("role", "cell");
    if (g.what) {
      const whatP = document.createElement("p");
      whatP.className = "private-what";
      renderRichText(toSentence(g.what), whatP);
      cell1.appendChild(whatP);
    }
    if (g.why) {
      const whyP = document.createElement("p");
      whyP.className = "private-why";
      renderRichText(toSentence(g.why), whyP);
      cell1.appendChild(whyP);
    }
    row.appendChild(cell1);

    const cell2 = document.createElement("div");
    cell2.setAttribute("role", "cell");
    const whereP = document.createElement("p");
    if (g.places.length === 1) whereP.appendChild(document.createTextNode("1 place in "));
    else whereP.appendChild(document.createTextNode(`${g.places.length} places in `));
    const folders = secretFolders(g.places);
    folders.forEach((f, idx) => {
      const code = document.createElement("code");
      code.textContent = f.folder;
      whereP.appendChild(code);
      if (idx < folders.length - 1) whereP.appendChild(document.createTextNode(", "));
    });
    cell2.appendChild(whereP);
    const details = document.createElement("details");
    details.setAttribute("data-key", `secrets-where-${i}`);
    const summaryEl = document.createElement("summary");
    summaryEl.className = "private-where";
    summaryEl.textContent = "Show every place";
    details.appendChild(summaryEl);
    const ul = document.createElement("ul");
    ul.className = "secret-list";
    for (const place of g.places) {
      const li = document.createElement("li");
      li.textContent = place;
      ul.appendChild(li);
    }
    details.appendChild(ul);
    cell2.appendChild(details);
    row.appendChild(cell2);

    const cell3 = document.createElement("div");
    cell3.setAttribute("role", "cell");
    if (g.fix) {
      const fixP = document.createElement("p");
      renderRichText(toSentence(g.fix), fixP);
      cell3.appendChild(fixP);
    }
    row.appendChild(cell3);

    table.appendChild(row);
  });

  inner.appendChild(table);
  section.appendChild(inner);
  return section;
}
