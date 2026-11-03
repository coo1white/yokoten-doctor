import { make, createIcon, createCommandBox, createFold, renderRichText } from "./dom.ts";
import { INSTALL_COMMAND, OPTIONAL_CHECK_IDS } from "../view.ts";
import { newFileLink, fileLinkPlan, buildPatch, orderFiles, savedCheckHref, PATCH_COMMANDS, isSafePath, savedFileText } from "../fixes.ts";
import type { CheckResult, FixesPayload, SaveStepKey, FixFile } from "../types.ts";

let isWholeFileShown = false;
const openedFiles = new Set<string>();
let copyStatus = "";

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

function createFilePath(file: FixFile): HTMLElement {
  const path = make("span", "file-path");
  const slash = file.path.lastIndexOf("/");
  if (slash === -1) {
    path.textContent = file.path;
  } else {
    const dir = make("span", "dir", file.path.slice(0, slash + 1));
    path.appendChild(dir);
    path.appendChild(document.createTextNode(file.path.slice(slash + 1)));
  }
  return path;
}

function createFileRow(file: FixFile, owner: string, repo: string, branch: string | null): { row: HTMLElement; addLink: HTMLAnchorElement; undoButton: HTMLButtonElement; isLong: boolean } {
  const link = fileLinkPlan(owner, repo, branch, file);
  const isLong = link.kind !== "filled";
  const row = make("li", "file");
  if (openedFiles.has(file.path)) row.classList.add("is-added");
  const path = createFilePath(file);
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
    row.appendChild(make("p", "file-how", "Paste it there, then commit it."));
    const read = make("div", "file-read");
    const body: Node[] = [createFilePre(file.content)];
    read.appendChild(createFold("Read this file", body, { key: `read-${file.path}` }));
    row.appendChild(read);
  }
  return { row, addLink, undoButton, isLong };
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
  const body: Node[] = [wrap, save, command];
  if (files.some((f) => f.path === "AGENTS.md")) {
    body.push(make("p", "small", "The patch also has AGENTS.md."));
  }
  const fold = createFold("Prefer the terminal?", body, { key: "use-terminal" });
  side.appendChild(fold);
  return side;
}

function createGitHubTop(pushClass: string): HTMLElement {
  const ghTop = make("div", "gh-top");
  ghTop.appendChild(make("span", "gh-repo", "your-project"));
  ghTop.appendChild(make("span", undefined, "/"));
  ghTop.appendChild(make("span", "gh-name", "AGENTS.md"));
  const push = make("span", "gh-push");
  push.appendChild(make("span", "gh-quiet", "Cancel changes"));
  push.appendChild(make("span", pushClass, "Commit changes..."));
  ghTop.appendChild(push);
  return ghTop;
}

function makeSavePart(tag: string, text: string, isAi: boolean): HTMLElement {
  const part = make("div", isAi ? "save-part is-ai" : "save-part");
  part.appendChild(make("span", "save-part-tag", tag));
  part.appendChild(make("span", "save-part-text", text));
  return part;
}

function createBoldLine(before: string, bold: string, after: string): HTMLElement {
  const p = make("p");
  p.appendChild(document.createTextNode(before));
  p.appendChild(make("b", undefined, bold));
  p.appendChild(document.createTextNode(after));
  return p;
}

function renderCopyStep(owner: string, repo: string, branch: string | null, agentsFile: FixFile, isWrittenByAi: boolean, isPreview: boolean, doneButton: HTMLElement | undefined): Node[] {
  const content = savedFileText(agentsFile.content, isWrittenByAi);
  const say = make("div", "save-say");
  const nodes: Node[] = [say];
  say.appendChild(createBoldLine("On this page, click ", "Copy and open GitHub", ". The file is copied, and GitHub opens in a new tab."));
  say.appendChild(make("p", "small", "Keep this page open. The next step is here. This has to be your project, and you need to be signed in to GitHub. It's easier on a computer."));
  const href = newFileLink(owner, repo, branch, "AGENTS.md", null);
  if (!isPreview) {
    const p3 = make("p", "small");
    p3.appendChild(document.createTextNode("Nothing opened? Your browser may have blocked it. "));
    const openLink = make("a", undefined, "Open GitHub");
    openLink.href = href;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    p3.appendChild(openLink);
    p3.appendChild(document.createTextNode("."));
    say.appendChild(p3);
  }
  const actions = make("div", "save-actions");
  if (isPreview) {
    const copyButton = make("button", "btn btn-primary ctl", "Copy and open GitHub");
    copyButton.type = "button";
    copyButton.disabled = true;
    actions.appendChild(copyButton);
    if (doneButton) actions.appendChild(doneButton);
    say.appendChild(actions);
  } else {
    const copyLink = make("a", "btn btn-primary ctl", "Copy and open GitHub");
    copyLink.href = href;
    actions.appendChild(copyLink);
    if (doneButton) actions.appendChild(doneButton);
    say.appendChild(actions);
    const status = make("p", "small muted");
    status.setAttribute("role", "status");
    status.textContent = copyStatus;
    say.appendChild(status);
    copyLink.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      const write = navigator.clipboard ? navigator.clipboard.writeText(content) : Promise.reject();
      write.then(() => {
        copyStatus = openTab(href) ? "Copied. Now go to the GitHub tab." : "Copied. Your browser blocked the new tab, so use Open GitHub above.";
        status.textContent = copyStatus;
      }, () => {
        showWholeFile(true);
        const isOpen = openTab(href);
        copyStatus = isOpen ? "We couldn't copy it. Copy the text from Read the whole file, then paste it on GitHub." : "We couldn't copy it, and your browser blocked the new tab. Copy the text from Read the whole file, then use Open GitHub above.";
        status.textContent = copyStatus;
      });
    });
  }
  const panel = make("div", "save-file");
  panel.setAttribute("aria-label", "What's in the file");
  const nameDiv = make("div", "save-file-name");
  nameDiv.appendChild(make("code", undefined, "AGENTS.md"));
  const readButton = make("button", "link ctl", "Read the whole file");
  readButton.type = "button";
  nameDiv.appendChild(readButton);
  panel.appendChild(nameDiv);
  if (isWrittenByAi) {
    panel.appendChild(makeSavePart("Written by the AI", "What you just read. Nothing else goes in the file.", true));
  } else {
    panel.appendChild(makeSavePart("Yours to fill in", "A place for how to build it, how to test it, and what not to touch.", true));
  }
  const wholeFile = createFilePre(content);
  wholeFile.hidden = !isWholeFileShown;
  readButton.setAttribute("aria-expanded", String(isWholeFileShown));
  panel.appendChild(wholeFile);
  nodes.push(panel);
  function showWholeFile(isShown: boolean): void {
    isWholeFileShown = isShown;
    wholeFile.hidden = !isWholeFileShown;
    readButton.setAttribute("aria-expanded", String(isWholeFileShown));
  }
  readButton.addEventListener("click", () => {
    showWholeFile(!isWholeFileShown);
  });
  return nodes;
}

function renderPasteStep(doneButton: HTMLElement | undefined): Node[] {
  const say = make("div", "save-say");
  const nodes: Node[] = [say];
  const p1 = make("p");
  p1.appendChild(document.createTextNode("On GitHub, click the big empty box. Then press "));
  p1.appendChild(make("b", undefined, "Ctrl + V"));
  p1.appendChild(document.createTextNode(". On a Mac, press "));
  p1.appendChild(make("b", undefined, "Command + V"));
  p1.appendChild(document.createTextNode("."));
  say.appendChild(p1);
  say.appendChild(make("p", "small", "The text appears in the box. The file name is already filled in, so leave it."));
  if (doneButton) {
    const actions = make("div", "save-actions");
    actions.appendChild(doneButton);
    say.appendChild(actions);
  }
  const shot = make("div", "save-shot");
  shot.setAttribute("role", "img");
  shot.setAttribute("aria-label", "The GitHub page, with the big empty box marked");
  const gh = make("div", "gh");
  gh.appendChild(createGitHubTop("gh-pale"));
  gh.appendChild(make("div", "gh-empty", "1"));
  shot.appendChild(gh);
  shot.appendChild(make("span", "save-key", "Ctrl + V"));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("save-pointer");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "#141413");
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("d", "M5 3l14 9-6.5 1.5L15 20l-3 1.5-2.6-6.4L5 19z");
  svg.appendChild(path);
  shot.appendChild(svg);
  nodes.push(shot);
  return nodes;
}

function renderSaveStep(doneButton: HTMLElement | undefined): Node[] {
  const say = make("div", "save-say");
  const nodes: Node[] = [say];
  say.appendChild(createBoldLine("On GitHub, click the green ", "Commit changes", " button. A box opens. Change nothing, and click the green button at the bottom of the box."));
  say.appendChild(make("p", "small", "See a green Create pull request button next? Your project asks for an extra step. Click it, then click Merge pull request. If you can't merge it, someone on your team has to approve it first."));
  if (doneButton) {
    const actions = make("div", "save-actions");
    actions.appendChild(doneButton);
    say.appendChild(actions);
  }
  const shot = make("div", "save-shot");
  shot.setAttribute("role", "img");
  shot.setAttribute("aria-label", "The green Commit changes button, and the green button in the box it opens");
  const gh = make("div", "gh");
  gh.appendChild(createGitHubTop("gh-green"));
  const editor = make("div", "gh-editor");
  editor.appendChild(document.createTextNode("# How to work on this project"));
  editor.appendChild(document.createElement("br"));
  editor.appendChild(document.createElement("br"));
  editor.appendChild(document.createTextNode("## Build"));
  gh.appendChild(editor);
  shot.appendChild(gh);
  shot.appendChild(make("div", "gh-dim"));
  const dialog = make("div", "gh-dialog");
  dialog.appendChild(make("strong", undefined, "Commit changes"));
  dialog.appendChild(make("i"));
  dialog.appendChild(make("i", "gh-tall"));
  const go = make("div", "gh-dialog-go");
  go.appendChild(make("span", "gh-green gh-mark", "Commit changes"));
  dialog.appendChild(go);
  shot.appendChild(dialog);
  nodes.push(shot);
  return nodes;
}

function renderCheckStep(owner: string, repo: string, isPreview: boolean): Node[] {
  const say = make("div", "save-say");
  const nodes: Node[] = [say];
  say.appendChild(createBoldLine("Come back to this page, and click ", "Check that it saved", ". We'll look for AGENTS.md in your project."));
  const actions = make("div", "save-actions");
  if (isPreview) {
    const button = make("button", "btn btn-primary ctl", "Check that it saved");
    button.type = "button";
    button.disabled = true;
    actions.appendChild(button);
  } else {
    const link = make("a", "btn btn-primary ctl", "Check that it saved");
    link.href = savedCheckHref(owner, repo);
    actions.appendChild(link);
  }
  say.appendChild(actions);
  const panel = make("div", "save-file");
  panel.setAttribute("aria-label", "What happens next");
  const there = makeSavePart("If it's there", "We show you how to try it with your AI tool.", true);
  const notThere = makeSavePart("If it isn't", "We tell you what's usually missing, and you can go back to the steps.", false);
  if (isPreview) {
    there.appendChild(createFold("See this screen", [make("p", "save-preview-title", "Saved. AGENTS.md is in your project."), make("p", "small", "Now try it. Open your AI tool in this project, and ask it this: What should you not touch in this project?")], { key: "screen-saved" }));
    notThere.appendChild(createFold("See this screen", [make("p", "save-preview-title", "We don't see AGENTS.md yet."), make("p", "small", "It has to reach your main branch. If GitHub showed a green Create pull request button, click it, then click Merge pull request.")], { key: "screen-not-found" }));
  }
  panel.appendChild(there);
  panel.appendChild(notThere);
  nodes.push(panel);
  return nodes;
}

export function renderSaveStepBody(key: SaveStepKey, input: { owner: string; repo: string; branch: string | null; agentsFile: FixFile; isWrittenByAi: boolean; isPreview: boolean; doneButton?: HTMLElement }): Node[] {
  const { owner, repo, branch, agentsFile, isWrittenByAi, isPreview, doneButton } = input;
  if (key === "copy") return renderCopyStep(owner, repo, branch, agentsFile, isWrittenByAi, isPreview, doneButton);
  if (key === "paste") return renderPasteStep(doneButton);
  if (key === "save") return renderSaveStep(doneButton);
  return renderCheckStep(owner, repo, isPreview);
}

export function renderOtherFilesBody(lastFixes: FixesPayload | null, lastResult: CheckResult, isExample: boolean): Node[] {
  const nodes: Node[] = [];
  if (isExample) {
    nodes.push(make("p", undefined, "On your own project, you can add any of these."));
  } else {
    nodes.push(make("p", undefined, "Add any you want. Each button opens GitHub with the file ready. Nothing changes until you commit."));
  }
  const files = (lastFixes?.files ?? []).filter((f) => f.path !== "AGENTS.md");
  const ordered = orderFiles(files);
  const all: FixFile[] = [];
  if (ordered.first) all.push(ordered.first);
  for (const item of ordered.rest) all.push(item);
  const owner = String(lastResult.owner ?? "");
  const repo = String(lastResult.repo ?? "");
  const branch: string | null = lastResult.default_branch ?? lastResult.branch ?? null;
  if (all.length > 0) {
    const list = make("ul", "files");
    list.setAttribute("data-file-list", "");
    for (const file of all) {
      if (isExample) {
        const row = make("li", "file");
        row.appendChild(createFilePath(file));
        list.appendChild(row);
      } else {
        const { row, addLink, undoButton, isLong } = createFileRow(file, owner, repo, branch);
        list.appendChild(row);
        addLink.addEventListener("click", (event: MouseEvent) => {
          if (!isLong) {
            setTimeout(() => {
              row.classList.add("is-added");
              openedFiles.add(file.path);
            }, 250);
            return;
          }
          if (row.classList.contains("is-blocked")) {
            row.classList.remove("is-blocked");
            row.querySelector(".blocked-note")?.remove();
            row.classList.add("is-added");
            openedFiles.add(file.path);
            return;
          }
          event.preventDefault();
          const openRow = (): void => {
            if (openTab(addLink.href)) {
              row.classList.add("is-added");
              openedFiles.add(file.path);
              return;
            }
            row.classList.add("is-blocked");
            if (!row.querySelector(".blocked-note")) {
              row.appendChild(make("p", "small blocked-note", "Your browser blocked the new tab. Click Copy and open GitHub again."));
            }
          };
          const copy = navigator.clipboard ? navigator.clipboard.writeText(file.content) : Promise.reject();
          copy.then(openRow, () => {
            const details = row.querySelector<HTMLDetailsElement>(".file-read details");
            if (details) details.open = true;
            openRow();
          });
        });
        undoButton.addEventListener("click", () => {
          row.classList.remove("is-added");
          openedFiles.delete(file.path);
        });
      }
    }
    nodes.push(list);
  }
  if (!isExample) {
    const orderedAll = orderFiles(lastFixes?.files ?? []);
    const allFiles: FixFile[] = [];
    if (orderedAll.first) allFiles.push(orderedAll.first);
    for (const item of orderedAll.rest) allFiles.push(item);
    if (allFiles.length > 0) {
      const mapped = allFiles.map((file) => file.path === "AGENTS.md" ? { ...file, content: savedFileText(file.content, file.source === "yokoten and Muse") } : file);
      nodes.push(createTerminalFold(mapped));
    }
  }
  return nodes;
}

export function renderOptionalBody(lastResult: CheckResult): Node[] {
  const nodes: Node[] = [];
  nodes.push(make("p", undefined, "yokoten is a separate tool. Install it if you want these checks running on your project. Your project isn't missing anything without them."));
  const steps = (lastResult.summary?.steps ?? []).filter((s) => OPTIONAL_CHECK_IDS.includes(s.id));
  const list = make("ul", "hand-files");
  for (const step of steps) {
    const li = make("li");
    renderRichText(step.title, li);
    list.appendChild(li);
  }
  nodes.push(list);
  nodes.push(createCommandBox(INSTALL_COMMAND));
  const p = make("p", "small");
  const link = make("a", "link ctl", "See what yokoten does");
  link.href = "https://yokoten.app/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  p.appendChild(link);
  nodes.push(p);
  return nodes;
}

function openTab(href: string): boolean {
  const tab = window.open(href, "_blank");
  if (!tab) return false;
  tab.opener = null;
  return true;
}
