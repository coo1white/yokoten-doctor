import { make, createIcon, createCommandBox, createFold, createStepHeading, createLink } from "./dom.ts";
import { formatRecordTime } from "../view.ts";
import { recordView } from "../fixes.ts";
import type { ViewModel } from "../types.ts";

export function proofNavTitle(lastRecord: unknown): string {
  const rv = recordView(lastRecord);
  const hasRecord = !!(rv && (rv.rekorUrl || rv.solanaUrl));
  return hasRecord ? "On record" : "No public record";
}

function makeRunWay(vm: ViewModel): HTMLElement {
  const way = document.createElement("div");
  way.className = "way";
  const strong = document.createElement("p");
  strong.className = "strong";
  strong.textContent = "Run the same check";
  way.appendChild(strong);
  const wayBody = document.createElement("div");
  wayBody.className = "way-body";
  const muted = document.createElement("p");
  muted.className = "small muted";
  muted.appendChild(document.createTextNode("Commit "));
  const codeCommit = document.createElement("code");
  codeCommit.textContent = vm.evidence.shortCommit ?? "";
  muted.appendChild(codeCommit);
  muted.appendChild(document.createTextNode(", yokoten "));
  muted.appendChild(document.createTextNode(vm.evidence.version ?? ""));
  muted.appendChild(document.createTextNode("."));
  wayBody.appendChild(muted);
  const commands = [vm.evidence.doctorCommand, vm.evidence.checkCommand].filter((s): s is string => Boolean(s)).join("\n");
  if (commands) {
    wayBody.appendChild(createCommandBox(commands));
  }
  way.appendChild(wayBody);
  return way;
}

export function renderProofSection({ vm, lastRecord }: { vm: ViewModel; lastRecord: unknown }): HTMLElement {
  const section = document.createElement("section");
  section.className = "step step-aside";
  section.id = "verify";
  const rv = recordView(lastRecord);
  const hasRecord = !!(rv && (rv.rekorUrl || rv.solanaUrl));
  if (hasRecord && rv) {
    const heading = createStepHeading(0, "");
    heading.appendChild(document.createTextNode("On record since "));
    const span = document.createElement("span");
    span.className = "nowrap";
    span.textContent = formatRecordTime(rv.recordedAt);
    heading.appendChild(span);
    section.appendChild(heading);
    const lede = make("p", "sec-lede", "Nothing to do here.");
    section.appendChild(lede);
    const confirmWay = document.createElement("div");
    confirmWay.className = "way";
    const strong = make("p", "strong", "Confirm the record");
    confirmWay.appendChild(strong);
    const ol = document.createElement("ol");
    ol.className = "steps-n";
    const liOne = document.createElement("li");
    const pOne = document.createElement("p");
    pOne.textContent = "Download the result.";
    liOne.appendChild(pOne);
    const divOne = document.createElement("div");
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn btn-line ctl";
    dlBtn.textContent = "Download";
    dlBtn.addEventListener("click", () => {
      const blob = new Blob([rv.documentText], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = rv.documentName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    divOne.appendChild(dlBtn);
    liOne.appendChild(divOne);
    ol.appendChild(liOne);
    const liTwo = document.createElement("li");
    const pTwo = document.createElement("p");
    pTwo.textContent = "Hash it.";
    liTwo.appendChild(pTwo);
    liTwo.appendChild(createCommandBox(rv.verifyCommand));
    ol.appendChild(liTwo);
    const liThree = document.createElement("li");
    const pThree = document.createElement("p");
    pThree.textContent = "The output has to match this hash:";
    liThree.appendChild(pThree);
    liThree.appendChild(createCommandBox(rv.sha256));
    if (rv.rekorUrl) {
      const link = createLink(rv.rekorUrl, "See it on Sigstore Rekor");
      link.classList.add("link", "ctl");
      link.appendChild(document.createTextNode(" "));
      link.appendChild(createIcon("out"));
      liThree.appendChild(link);
    } else if (rv.solanaUrl) {
      const link = createLink(rv.solanaUrl, "Solana devnet memo (test network)");
      link.classList.add("link", "ctl");
      link.appendChild(document.createTextNode(" "));
      link.appendChild(createIcon("out"));
      liThree.appendChild(link);
    }
    ol.appendChild(liThree);
    confirmWay.appendChild(ol);
    const runWay = makeRunWay(vm);
    const fold = createFold("Check it yourself", [confirmWay, runWay], { key: "proof-check" });
    section.appendChild(fold);
  } else {
    const heading = createStepHeading(0, "No public record for this result");
    section.appendChild(heading);
    const lede = make("p", "sec-lede", "The public record couldn't be written this time. The check still ran. Nothing to do here.");
    section.appendChild(lede);
    const runWay = makeRunWay(vm);
    const fold = createFold("Check it yourself", [runWay], { key: "proof-check" });
    section.appendChild(fold);
  }
  return section;
}
