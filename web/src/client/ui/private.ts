import { make, createFold, createStepHeading, renderRichText } from "./dom.ts";
import { toSentence } from "../view.ts";
import type { ViewModel } from "../types.ts";

export function renderPrivateSection({ vm }: { vm: ViewModel }): HTMLElement | null {
  if (!vm.secretCount || vm.secretCount === 0) {
    return null;
  }
  const section = document.createElement("section");
  section.id = "private";
  section.className = "step step-aside";
  const heading = createStepHeading(0, "Is this meant to be public?");
  section.appendChild(heading);
  const ul = document.createElement("ul");
  ul.className = "items";
  vm.secretGroups.forEach((g, index) => {
    const li = document.createElement("li");
    li.className = "item";
    const titleP = document.createElement("p");
    titleP.className = "item-title";
    const whatSpan = document.createElement("span");
    const what = (g as unknown as Record<string, unknown>).what as string | undefined;
    if (what) {
      whatSpan.textContent = what.charAt(0).toUpperCase() + what.slice(1);
    } else {
      whatSpan.textContent = "";
    }
    titleP.appendChild(whatSpan);
    const nSpan = document.createElement("span");
    nSpan.className = "n";
    const places = (g as unknown as Record<string, unknown>).places as string[];
    nSpan.textContent = places.length === 1 ? "1 place" : `${places.length} places`;
    titleP.appendChild(nSpan);
    li.appendChild(titleP);
    const foldTitle = places.length === 1 ? "Show the place" : `Show all ${places.length} places`;
    const placesUl = document.createElement("ul");
    placesUl.className = "places";
    placesUl.tabIndex = 0;
    for (const place of places) {
      const pli = document.createElement("li");
      pli.textContent = place;
      placesUl.appendChild(pli);
    }
    const fold = createFold(foldTitle, [placesUl], { key: `places-${index}`, className: "fold-main" });
    li.appendChild(fold);
    const outcomes = document.createElement("div");
    outcomes.className = "outcomes";
    const outOne = document.createElement("div");
    outOne.className = "outcome";
    const strongOne = document.createElement("p");
    strongOne.className = "strong";
    strongOne.textContent = "Shouldn't be public?";
    outOne.appendChild(strongOne);
    const pOne = document.createElement("p");
    const fix = (g as unknown as Record<string, unknown>).fix as string | undefined;
    if (fix) {
      const first = fix.split(/\. If /)[0];
      const sentence = toSentence(first);
      renderRichText(sentence, pOne);
    }
    outOne.appendChild(pOne);
    outcomes.appendChild(outOne);
    const outTwo = document.createElement("div");
    outTwo.className = "outcome";
    const strongTwo = document.createElement("p");
    strongTwo.className = "strong";
    strongTwo.textContent = "It's fine?";
    outTwo.appendChild(strongTwo);
    const pTwo = document.createElement("p");
    pTwo.appendChild(document.createTextNode("Add the exact text to "));
    const codeAllow = document.createElement("code");
    codeAllow.textContent = "privacy.allow";
    pTwo.appendChild(codeAllow);
    pTwo.appendChild(document.createTextNode(" in "));
    const codeJson = document.createElement("code");
    codeJson.textContent = "yokoten.json";
    pTwo.appendChild(codeJson);
    pTwo.appendChild(document.createTextNode("."));
    outTwo.appendChild(pTwo);
    outcomes.appendChild(outTwo);
    li.appendChild(outcomes);
    ul.appendChild(li);
  });
  section.appendChild(ul);
  return section;
}
