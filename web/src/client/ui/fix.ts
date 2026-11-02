import { make, createIcon, createCommandBox, createFold, createStepHeading, renderRichText } from "./dom.ts";
import { toSentence, INSTALL_COMMAND } from "../view.ts";
import { fileLinkPlan, buildPatch, orderFiles, fixMessage, claudeImportMessage, PATCH_COMMANDS, projectSection, rerunHref } from "../fixes.ts";
import type { ResultPlan, CheckResult, FixesPayload, HandItem, FixFile } from "../types.ts";

const openedFiles = new Set<string>();

export function clearOpenedFiles(): void {
  openedFiles.clear();
}

function createFilePre(content: string): HTMLElement {
  const pre = make("pre", "file-text");
  pre.tabIndex = 0;
  const code = make("code");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#")) {
      const span = make("span", "h", line);
      code.appendChild(span);
    } else if (line.startsWith("TODO")) {
      const span = make("span", "todo", line);
      code.appendChild(span);
    } else {
      code.appendChild(document.createTextNode(line));
    }
    if (i < lines.length - 1) {
      code.appendChild(document.createTextNode("\n"));
    }
  }
  pre.appendChild(code);
  return pre;
}

function startSection(id: string, stepNumber: number, title: string): HTMLElement {
  const section = make("section");
  section.id = id;
  if (stepNumber > 0) {
    section.className = "step";
    section.setAttribute("data-no", String(stepNumber));
  } else {
    section.className = "step step-aside";
  }
  const heading = createStepHeading(stepNumber, title);
  section.appendChild(heading);
  return section;
}

function createFileRow(file: FixFile, plan: ResultPlan, lastFixes: FixesPayload | null, owner: string, repo: string, branch: string | null): { row: HTMLElement; addLink: HTMLAnchorElement; undoButton: HTMLButtonElement; isLong: boolean } {
  const link = fileLinkPlan(owner, repo, branch, file);
  const isLong = link.kind !== "filled";
  const row = make("li", "file");
  if (openedFiles.has(file.path)) {
    row.classList.add("is-added");
  }
  const path = make("span", "file-path");
  const slash = file.path.lastIndexOf("/");
  if (slash === -1) {
    path.textContent = file.path;
  } else {
    const dir = make("span", "dir", file.path.slice(0, slash + 1));
    path.appendChild(dir);
    path.appendChild(document.createTextNode(file.path.slice(slash + 1)));
  }
  row.appendChild(path);
  const act = make("span", "file-act");
  const addLink = make("a", "btn btn-line file-btn ctl");
  addLink.setAttribute("data-add", "");
  addLink.href = link.href;
  addLink.target = "_blank";
  addLink.rel = "noopener noreferrer";
  addLink.textContent = isLong ? "Copy and open GitHub " : "Add on GitHub ";
  addLink.appendChild(createIcon("out"));
  act.appendChild(addLink);
  const mark = make("span", "added-mark");
  mark.appendChild(createIcon("check"));
  mark.appendChild(document.createTextNode(" Opened on GitHub"));
  act.appendChild(mark);
  const undoButton = make("button", "link link-quiet ctl added-undo", "Undo");
  undoButton.type = "button";
  act.appendChild(undoButton);
  row.appendChild(act);
  if (isLong) {
    row.appendChild(make("p", "file-how", "Paste it there, then pick a new branch."));
  }
  const message = lastFixes ? claudeImportMessage(lastFixes) : null;
  const hasImport = plan.handItems.some((item) => item.id === "import");
  if (file.path === "AGENTS.md" && message && !hasImport) {
    const more = make("div", "file-more");
    const note = make("p", "small", message);
    more.appendChild(note);
    row.appendChild(more);
  }
  const read = make("div", "file-read");
  const body: Node[] = [];
  const project = projectSection(file.content);
  const isMuse = file.source === "yokoten and Muse";
  if (file.path === "AGENTS.md" && isMuse && project) {
    body.push(make("p", "small muted", "The part Muse wrote:"));
    body.push(createFilePre(project));
    const before = file.content.slice(0, file.content.indexOf("## This project")).trim();
    body.push(createFold("The rest of the file", [createFilePre(before)], { key: "rest-AGENTS.md" }));
  } else {
    body.push(createFilePre(file.content));
  }
  read.appendChild(createFold("Read this file", body, { key: `read-${file.path}` }));
  row.appendChild(read);
  return { row, addLink, undoButton, isLong };
}

function createFileList(files: FixFile[], plan: ResultPlan, lastFixes: FixesPayload | null, lastResult: CheckResult, isQuiet: boolean): { list: HTMLUListElement; count: HTMLParagraphElement } {
  const list = make("ul", "files");
  list.setAttribute("data-file-list", "");
  if (isQuiet) {
    list.setAttribute("data-quiet", "");
  }
  const owner = lastResult.owner ?? "";
  const repo = lastResult.repo ?? "";
  const branch = lastResult.default_branch ?? lastResult.branch ?? null;
  const rows: HTMLElement[] = [];
  const links: HTMLAnchorElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  const flags: boolean[] = [];
  const paths: string[] = [];
  const contents: string[] = [];
  for (const file of files) {
    const entry = createFileRow(file, plan, lastFixes, owner, repo, branch);
    rows.push(entry.row);
    links.push(entry.addLink);
    buttons.push(entry.undoButton);
    flags.push(entry.isLong);
    paths.push(file.path);
    contents.push(file.content);
    list.appendChild(entry.row);
  }
  const count = make("p", "small muted");
  count.setAttribute("data-file-count", "");
  count.setAttribute("role", "status");
  const refresh = (): void => {
    let moved = false;
    for (const row of rows) {
      const link = row.querySelector<HTMLAnchorElement>("[data-add]");
      if (!link) continue;
      const isNext = !isQuiet && !moved && !row.classList.contains("is-added");
      if (isNext) moved = true;
      link.classList.toggle("btn-primary", isNext);
      link.classList.toggle("btn-line", !isNext);
    }
    const allAdded = rows.length > 0 && rows.every((row) => row.classList.contains("is-added"));
    count.textContent = allAdded ? "All opened. Commit them on GitHub, then run the check again." : "";
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const link = links[i];
    const button = buttons[i];
    const isLong = flags[i];
    const path = paths[i];
    const content = contents[i];
    link.addEventListener("click", (event: MouseEvent) => {
      if (isLong) {
        event.preventDefault();
        const open = (): void => {
          window.open(link.href, "_blank", "noopener,noreferrer");
        };
        const copy = navigator.clipboard ? navigator.clipboard.writeText(content) : Promise.reject();
        copy.then(open, () => {
          const details = row.querySelector<HTMLDetailsElement>(".file-read details");
          if (details) details.open = true;
          open();
        });
      }
      setTimeout(() => {
        row.classList.add("is-added");
        openedFiles.add(path);
        refresh();
      }, 250);
    });
    button.addEventListener("click", () => {
      row.classList.remove("is-added");
      openedFiles.delete(path);
      refresh();
    });
  }
  refresh();
  return { list, count };
}

function createTerminalFold(files: FixFile[]): HTMLElement {
  const side = make("div", "side-ways");
  const wrap = make("div");
  const button = make("button", "btn btn-line ctl", "Download the patch");
  button.type = "button";
  wrap.appendChild(button);
  button.addEventListener("click", () => {
    const patch = buildPatch(files);
    const blob = new Blob([patch], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = make("a");
    anchor.href = url;
    anchor.download = "yokoten-doctor.patch";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const save = make("p", "small", "Save it in your repo's folder, then run:");
  const command = createCommandBox(PATCH_COMMANDS);
  const fold = createFold("Prefer the terminal?", [wrap, save, command], { key: "use-terminal" });
  side.appendChild(fold);
  return side;
}

export function renderFilesSection({ plan, lastFixes, lastResult, stepNumber }: { plan: ResultPlan; lastFixes: FixesPayload | null; lastResult: CheckResult; stepNumber: number }): HTMLElement | null {
  if (plan.filesBlock === "hidden") return null;
  const section = startSection("files", stepNumber, plan.filesTitle);
  if (plan.filesBlock === "waiting") {
    const wait = make("div", "wait");
    wait.setAttribute("role", "status");
    const icon = make("i");
    icon.setAttribute("aria-hidden", "true");
    wait.appendChild(icon);
    wait.appendChild(make("p", undefined, "Writing the files. This part can take a little longer."));
    section.appendChild(wait);
    return section;
  }
  if (plan.filesBlock === "lost") {
    section.appendChild(make("p", "sec-lede", "The connection dropped before they came. The check above is still good."));
    const owner = lastResult.owner ?? "";
    const repo = lastResult.repo ?? "";
    const link = make("a", "btn btn-primary ctl", "Run the check again");
    link.href = rerunHref(owner, repo);
    section.appendChild(link);
    return section;
  }
  if (plan.filesBlock === "nothing") {
    const text = lastFixes ? fixMessage(lastFixes) : "";
    section.appendChild(make("p", "sec-lede", text));
    return section;
  }
  const files = lastFixes?.files ?? [];
  if (files.length > 0) {
    const lede = plan.gain > 0 ? `That gets you to ${plan.afterDone} of ${plan.total}. Each button opens GitHub with the file ready. Pick a new branch there to get a pull request. Nothing changes until you commit.` : `These alone won't change the count. Add them on a new branch. We can't write to your repo.`;
    section.appendChild(make("p", "sec-lede", lede));
  }
  if (lastFixes?.muse === "failed") {
    const notice = make("div", "notice");
    notice.setAttribute("role", "status");
    notice.appendChild(make("p", "notice-title", "Muse couldn't write the \u201cThis project\u201d section this time."));
    const small = make("p", "small");
    small.appendChild(document.createTextNode("Fill it in yourself. It sits at the end of "));
    const code = make("code", undefined, "AGENTS.md");
    small.appendChild(code);
    small.appendChild(document.createTextNode("."));
    notice.appendChild(small);
    section.appendChild(notice);
  }
  if (files.length > 0) {
    const ordered = orderFiles(files);
    const all: FixFile[] = [];
    if (ordered.first) all.push(ordered.first);
    for (const item of ordered.rest) all.push(item);
    const { list, count } = createFileList(all, plan, lastFixes, lastResult, stepNumber === 0);
    section.appendChild(list);
    section.appendChild(count);
    section.appendChild(createTerminalFold(all));
  }
  return section;
}

export function renderInstallSection(plan: ResultPlan, stepNumber: number): HTMLElement {
  const section = startSection("install", stepNumber, "Install yokoten");
  const installOnlyCount = plan.installSteps.length - plan.movedToInstall.length;
  let ledeText = "";
  if (installOnlyCount === 5) {
    ledeText = "Five checks need it running in your repo. No file can do these.";
  } else if (installOnlyCount === 1) {
    ledeText = "1 check needs it running in your repo. No file can do these.";
  } else {
    ledeText = `${installOnlyCount} checks need it running in your repo. No file can do these.`;
  }
  section.appendChild(make("p", "sec-lede", ledeText));
  section.appendChild(createCommandBox(INSTALL_COMMAND, { isBig: true, isPrimary: true }));
  for (const item of plan.movedToInstall) {
    const paragraph = make("p", "hand-after");
    let extra = "";
    if (item.fix && item.fix.includes("; then ")) {
      const index = item.fix.indexOf("; then ");
      const after = item.fix.slice(index + "; then ".length);
      extra = " " + toSentence("then " + after);
    }
    renderRichText(`It also fixes \u201c${item.title}\u201d.${extra}`, paragraph);
    section.appendChild(paragraph);
  }
  const quiet = make("div", "step-quiet");
  const see = make("a", "link ctl quiet-end", "See what yokoten does");
  see.href = "https://yokoten.app/";
  see.target = "_blank";
  see.rel = "noopener noreferrer";
  quiet.appendChild(see);
  const count = plan.installSteps.length;
  const list = make("ul", "small todo-list");
  for (const step of plan.installSteps) {
    const item = make("li");
    const mark = make("span", "status-mark");
    mark.appendChild(createIcon("circle"));
    item.appendChild(mark);
    const title = make("span");
    renderRichText(step.title, title);
    item.appendChild(title);
    list.appendChild(item);
  }
  quiet.appendChild(createFold(`Which ${count} checks`, [list], { key: "which-checks" }));
  section.appendChild(quiet);
  return section;
}

export function renderHandSection(plan: ResultPlan, stepNumber: number): HTMLElement {
  const section = startSection("hand", stepNumber, plan.handTitle);
  const items = plan.handItems.slice(0, plan.handCount);
  const short = plan.isHandListShort;
  const isOne = items.length === 1 && !short;
  const buildBody = (entry: HandItem, withTitle: boolean, isFirst: boolean): Node[] => {
    const nodes: Node[] = [];
    if (withTitle) {
      const title = make("p", "item-title");
      const line = make("span", "status-line");
      const mark = make("span", "status-mark");
      mark.appendChild(createIcon("circle"));
      line.appendChild(mark);
      const text = make("span");
      renderRichText(entry.title, text);
      line.appendChild(text);
      title.appendChild(line);
      nodes.push(title);
    }
    if (entry.wrong) {
      const wrong = make("p", "hand-wrong");
      renderRichText(entry.wrong, wrong);
      nodes.push(wrong);
    }
    if (entry.list.length > 0) {
      const list = make("ul", "hand-files");
      for (const file of entry.list) {
        list.appendChild(make("li", undefined, file));
      }
      nodes.push(list);
    }
    if (entry.command) {
      nodes.push(createCommandBox(entry.command, { isBig: true, isPrimary: isFirst }));
    }
    if (entry.after) {
      const after = make("p", "hand-after");
      renderRichText(entry.after, after);
      nodes.push(after);
    }
    return nodes;
  };
  if (isOne) {
    for (const node of buildBody(items[0], false, true)) section.appendChild(node);
  } else {
    const list = make("ul", "items");
    for (let i = 0; i < items.length; i++) {
      const item = make("li", "item");
      for (const node of buildBody(items[i], true, i === 0)) item.appendChild(node);
      list.appendChild(item);
    }
    section.appendChild(list);
  }
  if (short) {
    section.appendChild(make("p", "small muted hand-after", `See all ${plan.total} checks at the top for the rest.`));
  }
  return section;
}
