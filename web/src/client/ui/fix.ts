import { make, createIcon, createCommandBox, createFold, createStepHeading, renderRichText } from "./dom.ts";
import { toSentence, INSTALL_COMMAND } from "../view.ts";
import { fileLinkPlan, buildPatch, orderFiles, fixMessage, claudeImportMessage, PATCH_COMMANDS, projectSection, rerunHref } from "../fixes.ts";
import type { ResultPlan, CheckResult, FixesPayload, HandItem } from "../types.ts";

export const openedFiles = new Set<string>();

export function clearOpenedFiles(): void {
  openedFiles.clear();
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function createFilePre(content: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "file-text";
  pre.tabIndex = 0;
  const code = document.createElement("code");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#")) {
      const span = document.createElement("span");
      span.className = "h";
      span.textContent = line;
      code.appendChild(span);
    } else if (line.startsWith("TODO")) {
      const span = document.createElement("span");
      span.className = "todo";
      span.textContent = line;
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

export function renderFilesSection({ plan, lastFixes, lastResult, stepNumber }: { plan: ResultPlan; lastFixes: FixesPayload | null; lastResult: CheckResult; stepNumber: number }): HTMLElement | null {
  if (plan.filesBlock === "hidden") {
    return null;
  }
  const section = document.createElement("section");
  section.id = "files";
  if (stepNumber > 0) {
    section.className = "step";
    section.setAttribute("data-no", String(stepNumber));
  } else {
    section.className = "step step-aside";
  }
  const heading = createStepHeading(stepNumber, plan.filesTitle);
  section.appendChild(heading);
  if (plan.filesBlock === "waiting") {
    const wait = document.createElement("div");
    wait.className = "wait";
    wait.setAttribute("role", "status");
    const icon = document.createElement("i");
    icon.setAttribute("aria-hidden", "true");
    wait.appendChild(icon);
    const p = document.createElement("p");
    p.textContent = "Writing the files. This part can take a little longer.";
    wait.appendChild(p);
    section.appendChild(wait);
    return section;
  }
  if (plan.filesBlock === "lost") {
    const lede = make("p", "sec-lede", "The connection dropped before they came. The check above is still good.");
    section.appendChild(lede);
    const owner = String((lastResult as unknown as Record<string, unknown>).owner ?? "");
    const repo = String((lastResult as unknown as Record<string, unknown>).repo ?? "");
    const a = document.createElement("a");
    a.className = "btn btn-primary ctl";
    a.href = rerunHref(owner, repo);
    a.textContent = "Run the check again";
    section.appendChild(a);
    return section;
  }
  if (plan.filesBlock === "nothing") {
    const text = fixMessage(lastFixes as unknown as { files?: { path: string }[]; muse: string });
    const p = make("p", "sec-lede", text);
    section.appendChild(p);
    return section;
  }
  const files = (lastFixes?.files ?? []) as Array<{ path: string; content: string; source?: string }>;
  if (files.length > 0) {
    const counts = plan.gain > 0;
    const ledeText = counts
      ? `That gets you to ${plan.afterDone} of ${plan.total}. Each button opens GitHub with the file ready. Pick a new branch there to get a pull request. Nothing changes until you commit.`
      : `These alone won't change the count. Add them on a new branch. We can't write to your repo.`;
    const lede = make("p", "sec-lede", ledeText);
    section.appendChild(lede);
  }
  const museStatus = (lastFixes as unknown as Record<string, unknown> | null)?.muse;
  if (museStatus === "failed") {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    const title = document.createElement("p");
    title.className = "notice-title";
    title.textContent = "Muse couldn't write the \u201cThis project\u201d section this time.";
    notice.appendChild(title);
    const small = document.createElement("p");
    small.className = "small";
    small.appendChild(document.createTextNode("Fill it in yourself. It sits at the end of "));
    const code = document.createElement("code");
    code.textContent = "AGENTS.md";
    small.appendChild(code);
    small.appendChild(document.createTextNode("."));
    notice.appendChild(small);
    section.appendChild(notice);
  }
  if (files.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "files";
    ul.setAttribute("data-file-list", "");
    if (stepNumber === 0) {
      ul.setAttribute("data-quiet", "");
    }
    const ordered = orderFiles(files as Array<{ path: string; content: string; source?: string }>);
    const allFiles: Array<{ path: string; content: string; source?: string }> = [];
    if (ordered.first) {
      allFiles.push(ordered.first as { path: string; content: string; source?: string });
    }
    for (const f of ordered.rest) {
      allFiles.push(f as { path: string; content: string; source?: string });
    }
    const branch = (lastResult as unknown as Record<string, unknown>).default_branch as string | null ?? (lastResult as unknown as Record<string, unknown>).branch as string | null ?? null;
    const owner = String((lastResult as unknown as Record<string, unknown>).owner ?? "");
    const repo = String((lastResult as unknown as Record<string, unknown>).repo ?? "");
    for (const file of allFiles) {
      const li = document.createElement("li");
      li.className = "file";
      if (openedFiles.has(file.path)) {
        li.classList.add("is-added");
      }
      const pathSpan = document.createElement("span");
      pathSpan.className = "file-path";
      const idx = file.path.lastIndexOf("/");
      if (idx === -1) {
        pathSpan.textContent = file.path;
      } else {
        const dir = document.createElement("span");
        dir.className = "dir";
        dir.textContent = file.path.slice(0, idx + 1);
        pathSpan.appendChild(dir);
        pathSpan.appendChild(document.createTextNode(file.path.slice(idx + 1)));
      }
      li.appendChild(pathSpan);
      const actSpan = document.createElement("span");
      actSpan.className = "file-act";
      const planLink = fileLinkPlan(owner, repo, branch, file as { path: string; content: string });
      const isFilled = planLink.kind === "filled";
      const a = document.createElement("a");
      a.className = "btn btn-line file-btn ctl";
      a.setAttribute("data-add", "");
      a.href = planLink.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = isFilled ? "Add on GitHub " : "Copy and open GitHub ";
      a.appendChild(createIcon("out"));
      actSpan.appendChild(a);
      const addedMark = document.createElement("span");
      addedMark.className = "added-mark";
      addedMark.appendChild(createIcon("check"));
      addedMark.appendChild(document.createTextNode(" Opened on GitHub"));
      actSpan.appendChild(addedMark);
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "link link-quiet ctl added-undo";
      undo.textContent = "Undo";
      actSpan.appendChild(undo);
      li.appendChild(actSpan);
      if (!isFilled) {
        const how = make("p", "file-how", "Paste it there, then pick a new branch.");
        li.appendChild(how);
      }
      const importMsg = claudeImportMessage(lastFixes as unknown as { claude_import?: { file: string; line: string } | null });
      const hasImport = plan.handItems.some((it) => it.id === "import");
      if (file.path === "AGENTS.md" && importMsg && !hasImport) {
        const more = document.createElement("div");
        more.className = "file-more";
        const p = document.createElement("p");
        p.className = "small";
        p.textContent = importMsg;
        more.appendChild(p);
        li.appendChild(more);
      }
      const readDiv = document.createElement("div");
      readDiv.className = "file-read";
      const bodyNodes: Node[] = [];
      const proj = projectSection(file.content);
      const isMuse = (file as Record<string, unknown>).source === "yokoten and Muse";
      if (file.path === "AGENTS.md" && isMuse && proj) {
        const intro = make("p", "small muted", "The part Muse wrote:");
        bodyNodes.push(intro);
        const preOne = createFilePre(proj);
        bodyNodes.push(preOne);
        const before = file.content.slice(0, file.content.indexOf("## This project")).trim();
        const preRest = createFilePre(before);
        const restFold = createFold("The rest of the file", [preRest], { key: "rest-AGENTS.md" });
        bodyNodes.push(restFold);
      } else {
        const pre = createFilePre(file.content);
        bodyNodes.push(pre);
      }
      const fold = createFold("Read this file", bodyNodes, { key: "read-" + file.path });
      readDiv.appendChild(fold);
      li.appendChild(readDiv);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    const countP = document.createElement("p");
    countP.className = "small muted";
    countP.setAttribute("data-file-count", "");
    countP.setAttribute("role", "status");
    section.appendChild(countP);
    const side = document.createElement("div");
    side.className = "side-ways";
    const dlWrap = document.createElement("div");
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn btn-line ctl";
    dlBtn.textContent = "Download the patch";
    dlBtn.addEventListener("click", () => {
      const patch = buildPatch(files as Array<{ path: string; content: string }>);
      const blob = new Blob([patch], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const aTmp = document.createElement("a");
      aTmp.href = url;
      aTmp.download = "yokoten-doctor.patch";
      document.body.appendChild(aTmp);
      aTmp.click();
      aTmp.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    dlWrap.appendChild(dlBtn);
    const saveP = make("p", "small", "Save it in your repo's folder, then run:");
    const cmdBox = createCommandBox(PATCH_COMMANDS);
    const foldBody: Node[] = [dlWrap, saveP, cmdBox];
    const termFold = createFold("Prefer the terminal?", foldBody, { key: "use-terminal" });
    side.appendChild(termFold);
    section.appendChild(side);
    const rows = Array.from(ul.querySelectorAll(".file")) as HTMLElement[];
    const quiet = ul.hasAttribute("data-quiet");
    const countEl = ul.nextElementSibling as HTMLElement | null;
    const refresh = (): void => {
      let moved = false;
      for (const row of rows) {
        const add = row.querySelector("[data-add]") as HTMLElement | null;
        if (!add) {
          continue;
        }
        const isNext = !quiet && !moved && !row.classList.contains("is-added");
        if (isNext) {
          moved = true;
        }
        add.classList.toggle("btn-primary", isNext);
        add.classList.toggle("btn-line", !isNext);
      }
      if (countEl && countEl.hasAttribute("data-file-count")) {
        const allAdded = rows.length > 0 && rows.every((r) => r.classList.contains("is-added"));
        countEl.textContent = allAdded ? "All opened. Commit them on GitHub, then run the check again." : "";
      }
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const file = allFiles[i];
      const add = row.querySelector("[data-add]") as HTMLAnchorElement | null;
      const undo = row.querySelector(".added-undo") as HTMLElement | null;
      if (!add || !undo) {
        continue;
      }
      const planLink = fileLinkPlan(owner, repo, branch, file as { path: string; content: string });
      const isLong = planLink.kind !== "filled";
      const path = file.path;
      const content = file.content;
      add.addEventListener("click", (e: MouseEvent) => {
        if (isLong) {
          e.preventDefault();
          const open = (): void => {
            window.open(add.href, "_blank", "noopener,noreferrer");
          };
          const nav = navigator as unknown as { clipboard?: { writeText(text: string): Promise<void> } };
          const copy = nav.clipboard ? nav.clipboard.writeText(content) : Promise.reject();
          copy.then(open, () => {
            const d = row.querySelector(".file-read details") as HTMLDetailsElement | null;
            if (d) {
              d.open = true;
            }
            open();
          });
        }
        setTimeout(() => {
          row.classList.add("is-added");
          openedFiles.add(path);
          refresh();
        }, 250);
      });
      undo.addEventListener("click", () => {
        row.classList.remove("is-added");
        openedFiles.delete(path);
        refresh();
      });
    }
    refresh();
  }
  return section;
}

export function renderInstallSection(plan: ResultPlan, stepNumber: number): HTMLElement {
  const section = document.createElement("section");
  section.id = "install";
  if (stepNumber > 0) {
    section.className = "step";
    section.setAttribute("data-no", String(stepNumber));
  } else {
    section.className = "step step-aside";
  }
  const heading = createStepHeading(stepNumber, "Install yokoten");
  section.appendChild(heading);
  const installOnlyCount = plan.installSteps.length - plan.movedToInstall.length;
  let ledeText = "";
  if (installOnlyCount === 5) {
    ledeText = "Five checks need it running in your repo. No file can do these.";
  } else if (installOnlyCount === 1) {
    ledeText = "1 check needs it running in your repo. No file can do these.";
  } else {
    ledeText = `${installOnlyCount} checks need it running in your repo. No file can do these.`;
  }
  const lede = make("p", "sec-lede", ledeText);
  section.appendChild(lede);
  const cmd = createCommandBox(INSTALL_COMMAND, { isBig: true, isPrimary: true });
  section.appendChild(cmd);
  for (const item of plan.movedToInstall) {
    const p = document.createElement("p");
    p.className = "hand-after";
    const title = (item as unknown as Record<string, unknown>).title as string ?? "";
    const fixRaw = (item as unknown as Record<string, unknown>).fix as string ?? "";
    let extra = "";
    if (typeof fixRaw === "string" && fixRaw.includes("; then ")) {
      const idx = fixRaw.indexOf("; then ");
      const after = fixRaw.slice(idx + "; then ".length);
      extra = " " + toSentence("then " + after);
    }
    const full = `It also fixes \u201c${title}\u201d.${extra}`;
    renderRichText(full, p);
    section.appendChild(p);
  }
  const quietDiv = document.createElement("div");
  quietDiv.className = "step-quiet";
  const seeLink = document.createElement("a");
  seeLink.href = "https://yokoten.app/";
  seeLink.target = "_blank";
  seeLink.rel = "noopener noreferrer";
  seeLink.className = "link ctl quiet-end";
  seeLink.textContent = "See what yokoten does";
  quietDiv.appendChild(seeLink);
  const n = plan.installSteps.length;
  const foldTitle = `Which ${n} checks`;
  const ul = document.createElement("ul");
  ul.className = "small todo-list";
  for (const s of plan.installSteps) {
    const li = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = "status-mark";
    mark.appendChild(createIcon("circle"));
    li.appendChild(mark);
    const titleSpan = document.createElement("span");
    const t = (s as unknown as Record<string, unknown>).title as string ?? "";
    renderRichText(t, titleSpan);
    li.appendChild(titleSpan);
    ul.appendChild(li);
  }
  const fold = createFold(foldTitle, [ul], { key: "which-checks" });
  quietDiv.appendChild(fold);
  section.appendChild(quietDiv);
  return section;
}

export function renderHandSection(plan: ResultPlan, stepNumber: number): HTMLElement {
  const section = document.createElement("section");
  section.id = "hand";
  if (stepNumber > 0) {
    section.className = "step";
    section.setAttribute("data-no", String(stepNumber));
  } else {
    section.className = "step step-aside";
  }
  const heading = createStepHeading(stepNumber, plan.handTitle);
  section.appendChild(heading);
  const items = plan.handItems.slice(0, plan.handCount);
  const short = plan.isHandListShort;
  const isOne = items.length === 1 && !short;
  const buildBody = (h: HandItem, withTitle: boolean, isFirst: boolean): Node[] => {
    const nodes: Node[] = [];
    if (withTitle) {
      const p = document.createElement("p");
      p.className = "item-title";
      const line = document.createElement("span");
      line.className = "status-line";
      const mark = document.createElement("span");
      mark.className = "status-mark";
      mark.appendChild(createIcon("circle"));
      line.appendChild(mark);
      const titleSpan = document.createElement("span");
      renderRichText(h.title ?? "", titleSpan);
      line.appendChild(titleSpan);
      p.appendChild(line);
      nodes.push(p);
    }
    if (h.wrong) {
      const p = document.createElement("p");
      p.className = "hand-wrong";
      renderRichText(h.wrong, p);
      nodes.push(p);
    }
    if (h.list && h.list.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "hand-files";
      for (const entry of h.list) {
        const li = document.createElement("li");
        li.textContent = entry;
        ul.appendChild(li);
      }
      nodes.push(ul);
    }
    if (h.command) {
      const box = createCommandBox(h.command, { isBig: true, isPrimary: isFirst });
      nodes.push(box);
    }
    if (h.after) {
      const p = document.createElement("p");
      p.className = "hand-after";
      renderRichText(h.after, p);
      nodes.push(p);
    }
    return nodes;
  };
  if (isOne) {
    const body = buildBody(items[0], false, true);
    for (const n of body) {
      section.appendChild(n);
    }
  } else {
    const ul = document.createElement("ul");
    ul.className = "items";
    for (let i = 0; i < items.length; i++) {
      const li = document.createElement("li");
      li.className = "item";
      const body = buildBody(items[i], true, i === 0);
      for (const n of body) {
        li.appendChild(n);
      }
      ul.appendChild(li);
    }
    section.appendChild(ul);
  }
  if (plan.isHandListShort) {
    const p = make("p", "small muted hand-after", `See all ${plan.total} checks at the top for the rest.`);
    section.appendChild(p);
  }
  return section;
}
