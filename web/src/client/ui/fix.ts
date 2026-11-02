import { createLink, addCopyButton, createPanel } from "./dom.ts";
import { fileLinkPlan, buildPatch, orderFiles, fixMessage, claudeImportMessage, PATCH_COMMANDS, projectSection, isFilesSectionHidden, rerunHref } from "../fixes.ts";
import type { CheckResult, FixesPayload, ViewModel } from "../types.ts";

function createFileRow(owner: string, repo: string, branch: string | null, file: { path: string; content: string; source?: string }, isFirst: boolean, lastFixes: FixesPayload | null): HTMLLIElement {
  const li = document.createElement("li");
  li.className = isFirst ? "file-row is-first" : "file-row";
  const pathSpan = document.createElement("span");
  pathSpan.className = "file-path";
  pathSpan.textContent = file.path;
  li.appendChild(pathSpan);
  const plan = fileLinkPlan(owner, repo, branch, file);
  const preWrap = document.createElement("div");
  preWrap.className = "code-wrap";
  const pre = document.createElement("pre");
  pre.className = "fix-code";
  const code = document.createElement("code");
  code.textContent = file.content;
  pre.appendChild(code);
  preWrap.appendChild(pre);
  if (plan.kind !== "filled") {
    const fileActions = document.createElement("div");
    fileActions.className = "file-actions";
    const copyBtn = addCopyButton("Copy the file", file.content, code);
    if (isFirst) copyBtn.className = "file-action-primary";
    fileActions.appendChild(copyBtn);
    const action = document.createElement("a");
    action.href = plan.href;
    action.textContent = "Then add it on GitHub";
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.className = "file-action-link";
    fileActions.appendChild(action);
    li.appendChild(fileActions);
    const hint = document.createElement("p");
    hint.className = "small muted file-hint";
    hint.textContent = "GitHub opens an empty file. Paste, then pick a new branch.";
    li.appendChild(hint);
  } else {
    const action = document.createElement("a");
    action.href = plan.href;
    action.textContent = "Add on GitHub";
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    if (isFirst) action.className = "file-action-primary";
    else action.className = "file-action-link";
    li.appendChild(action);
    const copyBtn2 = addCopyButton("Copy", file.content, code);
    preWrap.appendChild(copyBtn2);
  }
  const details = document.createElement("details");
  details.setAttribute("data-key", "read-" + file.path);
  const sum = document.createElement("summary");
  sum.textContent = "Read this file";
  details.appendChild(sum);
  details.appendChild(preWrap);
  if (file.path === "AGENTS.md" && lastFixes) {
    const msg = claudeImportMessage(lastFixes);
    if (msg) {
      const claudeP = document.createElement("p");
      claudeP.textContent = msg;
      details.appendChild(claudeP);
    }
  }
  if (plan.kind === "filled") {
    const hint = document.createElement("p");
    hint.className = "small muted";
    hint.textContent = "GitHub opens a commit form. Pick a new branch to get a pull request.";
    details.appendChild(hint);
  }
  const wrap = document.createElement("div");
  wrap.className = "file-details-wrap";
  wrap.appendChild(details);
  li.appendChild(wrap);
  return li;
}

export function renderFixSection({ vm, lastFixes, isWaitingForFixes, lastResult }: { vm: ViewModel; lastFixes: FixesPayload | null; isWaitingForFixes: boolean; lastResult: CheckResult }): HTMLElement | null {
  const files = lastFixes?.files ?? [];
  const hasOpenInstallOnly = vm.installOnly.length > 0;
  if (isFilesSectionHidden(lastFixes, hasOpenInstallOnly)) return null;
  const section = document.createElement("section");
  section.id = "files";
  section.className = "band";
  const inner = document.createElement("div");
  inner.className = "band-inner files-grid";
  section.appendChild(inner);

  const left = document.createElement("div");
  left.className = "fix-left";
  inner.appendChild(left);

  const label = document.createElement("p");
  label.className = "section-label";
  label.textContent = "Files";
  left.appendChild(label);

  if (isWaitingForFixes && !lastFixes) {
    const h2 = document.createElement("h2");
    h2.className = "section-title";
    h2.textContent = "Your files";
    left.appendChild(h2);
    const waitingP = document.createElement("p");
    waitingP.textContent = "Writing the files…";
    left.appendChild(waitingP);
    return section;
  }

  if (lastFixes) {
    if (lastFixes.muse === "lost") {
      const h2 = document.createElement("h2");
      h2.className = "section-title";
      h2.textContent = "Your files";
      left.appendChild(h2);
      const lostP = document.createElement("p");
      lostP.appendChild(document.createTextNode("The files didn't arrive. "));
      const owner = String(lastResult.owner ?? "");
      const repo = String(lastResult.repo ?? "");
      const a = document.createElement("a");
      a.textContent = "Run the check again";
      a.href = rerunHref(owner, repo);
      lostP.appendChild(a);
      lostP.appendChild(document.createTextNode("."));
      left.appendChild(lostP);
      return section;
    }
    const msg = fixMessage(lastFixes);
    if (msg && (files.length > 0 || lastFixes.muse === "failed")) {
      const msgP = document.createElement("p");
      msgP.textContent = msg;
      if (lastFixes.muse === "failed") msgP.className = "error-box";
      left.appendChild(msgP);
    }
    if (files.length > 0) {
      const count = files.length;
      const h2 = document.createElement("h2");
      h2.className = "section-title";
      h2.textContent = count === 1 ? "1 file, written for this repo" : `${count} files, written for this repo`;
      left.appendChild(h2);
      const notice = document.createElement("p");
      notice.className = "files-notice";
      notice.textContent = "Nothing changes until you commit. We can't write to your repo.";
      left.appendChild(notice);
      const owner = String(lastResult.owner ?? "");
      const repo = String(lastResult.repo ?? "");
      const branch = (lastResult.default_branch as string | null) ?? (lastResult.branch as string | null) ?? null;
      const ordered = orderFiles(files);
      const allFiles: { path: string; content: string; source?: string }[] = [];
      if (ordered.first) allFiles.push(ordered.first);
      for (const f of ordered.rest) allFiles.push(f);
      const ul = document.createElement("ul");
      ul.className = "file-list";
      for (let i = 0; i < allFiles.length; i++) {
        const row = createFileRow(owner, repo, branch, allFiles[i], i === 0, lastFixes);
        ul.appendChild(row);
      }
      left.appendChild(ul);

      const termDetails = document.createElement("details");
      termDetails.setAttribute("data-key", "use-terminal");
      const termSum = document.createElement("summary");
      termSum.textContent = "Prefer the terminal?";
      termDetails.appendChild(termSum);
      const dlBtn = document.createElement("button");
      dlBtn.textContent = "Download the patch";
      dlBtn.className = "button-quiet";
      dlBtn.type = "button";
      dlBtn.addEventListener("click", () => {
        const patch = buildPatch(files);
        const blob = new Blob([patch], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "yokoten-doctor.patch";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      termDetails.appendChild(dlBtn);
      const putP = document.createElement("p");
      putP.textContent = "Save it in your repo's folder, then run:";
      termDetails.appendChild(putP);
      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      const pre2 = document.createElement("pre");
      const code2 = document.createElement("code");
      code2.textContent = PATCH_COMMANDS;
      pre2.appendChild(code2);
      wrap.appendChild(pre2);
      const copyBtn3 = addCopyButton("Copy", PATCH_COMMANDS, code2);
      wrap.appendChild(copyBtn3);
      termDetails.appendChild(wrap);
      left.appendChild(termDetails);
    } else {
      if (lastFixes.muse !== "failed") {
        const hasOpen = vm.installOnly.length > 0;
        if (!hasOpen) {
          const h2 = document.createElement("h2");
          h2.className = "section-title";
          h2.textContent = "Nothing to add";
          left.appendChild(h2);
          const nothingP = document.createElement("p");
          nothingP.textContent = msg;
          left.appendChild(nothingP);
        }
      } else {
        const h2 = document.createElement("h2");
        h2.className = "section-title";
        h2.textContent = "Your files";
        left.appendChild(h2);
      }
    }
  } else {
    const h2 = document.createElement("h2");
    h2.className = "section-title";
    h2.textContent = "Your files";
    left.appendChild(h2);
  }

  const hasAgents = lastFixes && lastFixes.files && lastFixes.files.some((f) => f.path === "AGENTS.md");
  if (hasAgents) {
    const agentsFile = (lastFixes as FixesPayload).files.find((f) => f.path === "AGENTS.md");
    const content = agentsFile ? agentsFile.content : "";
    const text = projectSection(content);
    const asideText = agentsFile?.source === "yokoten and Muse" ? "The part Muse wrote. The full file is in the list." : "Fill in this part. The full file is in the list.";
    const { panel, body } = createPanel("AGENTS.md", asideText);
    panel.classList.add("agents-panel");
    body.classList.add("agents-body");
    const pre = document.createElement("pre");
    pre.className = "agents-pre";
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineSpan = document.createElement("span");
      lineSpan.className = "agents-line";
      if (line.startsWith("#")) lineSpan.classList.add("is-heading");
      if (line.startsWith("TODO")) lineSpan.classList.add("is-todo");
      lineSpan.textContent = line;
      pre.appendChild(lineSpan);
      if (i < lines.length - 1) pre.appendChild(document.createTextNode("\n"));
    }
    body.appendChild(pre);
    inner.appendChild(panel);
  }

  return section;
}

export function renderGuardSection({ vm }: { vm: ViewModel }): HTMLElement | null {
  if (!vm.installOnly || vm.installOnly.length === 0) return null;
  const section = document.createElement("section");
  section.className = "section-inner guard-section guard-grid";
  section.id = "needs-yokoten";
  const left = document.createElement("div");
  left.className = "guard-left";
  const label = document.createElement("p");
  label.className = "section-label";
  label.textContent = "Needs yokoten";
  left.appendChild(label);
  const n = vm.installOnly.length;
  const h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = n === 1 ? "1 check needs yokoten installed" : `${n} checks need yokoten installed`;
  left.appendChild(h2);
  const ul = document.createElement("ul");
  ul.className = "guard-list";
  for (const s of vm.installOnly) {
    const li = document.createElement("li");
    const box = document.createElement("span");
    box.className = "chart-box";
    box.setAttribute("aria-hidden", "true");
    li.appendChild(box);
    const titleSpan = document.createElement("span");
    titleSpan.textContent = s.title;
    li.appendChild(titleSpan);
    ul.appendChild(li);
  }
  left.appendChild(ul);
  section.appendChild(left);
  const right = document.createElement("div");
  right.className = "guard-right";
  const p2 = document.createElement("p");
  p2.className = "guard-note";
  p2.appendChild(document.createTextNode("No file can do these. yokoten has to run in your repo ("));
  p2.appendChild(createLink("https://yokoten.app/", "see what it does"));
  p2.appendChild(document.createTextNode("). Install it:"));
  right.appendChild(p2);
  const cmdRow = document.createElement("div");
  cmdRow.className = "cmd-row";
  const code = document.createElement("code");
  code.className = "cmd-code";
  code.textContent = "npx yokoten init";
  cmdRow.appendChild(code);
  const copyBtn = addCopyButton("Copy", "npx yokoten init", code);
  cmdRow.appendChild(copyBtn);
  right.appendChild(cmdRow);
  section.appendChild(right);
  return section;
}
