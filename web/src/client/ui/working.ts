import { make, createIcon } from "./dom.ts";

export function renderWorking({ repoName, progress }: { repoName: string; progress: string[] }): HTMLElement {
  const steps: Array<[string, string]> = [
    ["reading", "Looking up the repo"],
    ["copying", "Copying the public files"],
    ["checking", "Running yokoten with the network off"],
    ["muse", "Muse is writing the project section"],
  ];
  const lastStep = progress.length > 0 ? progress[progress.length - 1] : null;
  const stepOrder = steps.map(([id]) => id);
  const lastIndex = lastStep ? stepOrder.indexOf(lastStep) : -1;
  const effectiveLast = lastIndex === -1 ? 0 : lastIndex;
  const band = make("div", "band");
  const wide = make("div", "wide");
  const run = make("div", "run");
  const h1 = document.createElement("h1");
  const nameSpan = document.createElement("span");
  nameSpan.textContent = repoName;
  h1.appendChild(nameSpan);
  run.appendChild(h1);
  const note = make("p", "run-note", "Checking. Usually about 15 seconds.");
  run.appendChild(note);
  const ul = document.createElement("ul");
  ul.className = "run-steps";
  ul.setAttribute("role", "status");
  for (let i = 0; i < steps.length; i++) {
    const [id, label] = steps[i];
    const isMuse = id === "muse";
    let state: string;
    if (i < effectiveLast) {
      state = "is-done";
    } else if (i === effectiveLast) {
      state = "is-now";
    } else {
      state = "is-wait";
    }
    if (isMuse && lastStep === "checking") {
      state = "is-wait";
    }
    const li = document.createElement("li");
    if (state === "is-done") {
      li.className = "is-done";
    } else if (state === "is-now") {
      li.className = "is-now";
    }
    const ic = document.createElement("span");
    ic.className = "run-ic";
    const iEl = document.createElement("i");
    ic.appendChild(iEl);
    ic.appendChild(createIcon("check"));
    li.appendChild(ic);
    li.appendChild(document.createTextNode(label));
    ul.appendChild(li);
  }
  run.appendChild(ul);
  wide.appendChild(run);
  band.appendChild(wide);
  return band;
}
