import { createFold, createRow, make, renderRichText } from "./dom.ts";
import { toSentence, topFolders } from "../view.ts";
import type { ViewModel } from "../types.ts";

const MANY_PLACES = 20;

export function renderPrivateRow({ vm }: { vm: ViewModel }): HTMLElement | null {
  if (vm.secretCount === 0) {
    return null;
  }
  const side = vm.secretCount === 1 ? "1 place" : `${vm.secretCount} places`;
  const list = make("ul", "items");
  vm.secretGroups.forEach((group, index) => {
    list.appendChild(createGroupRow(group, index));
  });
  return createRow("Is this meant to be public?", side, [list], { key: "private", id: "private", isSideTodo: true });
}

function createGroupRow(group: ViewModel["secretGroups"][number], index: number): HTMLElement {
  const item = make("li", "item");
  item.appendChild(createTitle(group));
  if (group.places.length > MANY_PLACES) {
    item.appendChild(createManyNote(group.places));
  }
  item.appendChild(createPlacesFold(group, index));
  item.appendChild(createOutcomes(group.fix));
  return item;
}

function createTitle(group: ViewModel["secretGroups"][number]): HTMLElement {
  const title = make("p", "item-title");
  title.appendChild(createWhatSpan(group.what));
  title.appendChild(createCountSpan(group.places));
  return title;
}

function createWhatSpan(what?: string): HTMLElement {
  const text = what ? what.charAt(0).toUpperCase() + what.slice(1) : "";
  return make("span", undefined, text);
}

function createCountSpan(places: string[]): HTMLElement {
  const label = places.length === 1 ? "1 place" : `${places.length} places`;
  return make("span", "n", label);
}

function createManyNote(places: string[]): HTMLElement {
  const note = make("div", "many");
  note.appendChild(make("p", "small", "A long list is often test data, or numbers inside images. Open a few before you change anything. Most are in:"));
  const list = make("ul", "places");
  for (const { folder, count } of topFolders(places, 5)) {
    list.appendChild(make("li", undefined, `${folder} (${count})`));
  }
  note.appendChild(list);
  return note;
}

function createPlacesFold(group: ViewModel["secretGroups"][number], index: number): HTMLElement {
  const places = group.places;
  const title = places.length === 1 ? "Show the place" : `Show all ${places.length} places`;
  const list = make("ul", "places");
  list.tabIndex = 0;
  for (const place of places) {
    list.appendChild(make("li", undefined, place));
  }
  return createFold(title, [list], { key: `places-${index}`, className: "fold-main" });
}

function createOutcomes(fix?: string): HTMLElement {
  const outcomes = make("div", "outcomes");
  outcomes.appendChild(createFixOutcome(fix));
  outcomes.appendChild(createAllowOutcome());
  return outcomes;
}

function createFixOutcome(fix?: string): HTMLElement {
  const box = createOutcomeBox("Shouldn't be public?");
  const paragraph = make("p");
  if (fix) {
    const first = fix.split(/\. If /)[0];
    const sentence = toSentence(first);
    renderRichText(sentence, paragraph);
  }
  box.appendChild(paragraph);
  return box;
}

function createAllowOutcome(): HTMLElement {
  const box = createOutcomeBox("It's fine?");
  const paragraph = make("p");
  paragraph.appendChild(document.createTextNode("Leave it. Some text is public on purpose. With yokoten, add the exact text to "));
  paragraph.appendChild(make("code", undefined, "privacy.allow"));
  paragraph.appendChild(document.createTextNode(" in "));
  paragraph.appendChild(make("code", undefined, "yokoten.json"));
  paragraph.appendChild(document.createTextNode("."));
  box.appendChild(paragraph);
  return box;
}

function createOutcomeBox(title: string): HTMLElement {
  const box = make("div", "outcome");
  box.appendChild(make("p", "strong", title));
  return box;
}
