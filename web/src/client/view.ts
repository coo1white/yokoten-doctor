import type { CheckResult, FixesPayload, ViewModel, Rerun, ResultPlan, StepKey, FilesBlock, HandItem } from "./types.ts";

export function toSentence(text: string): string {
  if (!text) return "";
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  const last = first.charAt(first.length - 1);
  if (last === "." || last === "!" || last === "?") return first;
  return first + ".";
}

export function splitCode(text: string): { text: string; isCode: boolean }[] {
  if (typeof text !== "string") return [{ text: String(text), isCode: false }];
  const out: { text: string; isCode: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("`", i);
    if (start === -1) {
      out.push({ text: text.slice(i), isCode: false });
      break;
    }
    const end = text.indexOf("`", start + 1);
    if (end === -1) {
      out.push({ text: text.slice(i), isCode: false });
      break;
    }
    if (start > i) out.push({ text: text.slice(i, start), isCode: false });
    out.push({ text: text.slice(start + 1, end), isCode: true });
    i = end + 1;
  }
  return out;
}

export function formatRecordTime(iso: string): string {
  if (typeof iso !== "string") return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  return `${y}-${m}-${day} ${h}:${min} UTC`;
}

function isValidRepoPart(part: string): boolean {
  if (part.length === 0) return false;
  if (part === "." || part === "..") return false;
  return /^[A-Za-z0-9._-]+$/.test(part);
}

function isValidRepo(owner: string, repo: string): boolean {
  return isValidRepoPart(owner) && isValidRepoPart(repo);
}

export function repoFromInput(text: string): string | null {
  if (typeof text !== "string") return null;
  let t = text.trim();
  if (!t) return null;
  const prefixRe = /^https:\/\/github\.com\//i;
  if (prefixRe.test(t)) {
    t = t.replace(prefixRe, "");
    t = t.replace(/\/+$/, "");
    if (t.toLowerCase().endsWith(".git")) t = t.slice(0, -4);
    const parts = t.split("/").filter((p) => p.length > 0);
    if (parts.length !== 2) return null;
    const [owner, repo] = parts;
    if (!isValidRepo(owner, repo)) return null;
    return `${owner}/${repo}`;
  }
  if (t.includes(" ") || t.includes("://")) return null;
  const cleaned = t.replace(/\/+$/, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  let r = repo;
  if (r.toLowerCase().endsWith(".git")) r = r.slice(0, -4);
  if (!isValidRepo(owner, r)) return null;
  return `${owner}/${r}`;
}

export function repoFromQuery(search: string): string | null {
  if (typeof search !== "string") return null;
  let s = search;
  if (s.startsWith("?")) s = s.slice(1);
  const params = new URLSearchParams(s);
  const v = params.get("repo");
  if (!v) return null;
  const t = v.trim();
  const parts = t.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!isValidRepo(owner, repo)) return null;
  return `${owner}/${repo}`;
}

export function markLabel(mark: string, reason: string | undefined): string {
  if (mark === "done") return "done";
  if (mark === "to do" || mark === "next") return "to do";
  if (mark === "not now") {
    if (reason) return `skipped on purpose: ${reason}`;
    return "skipped on purpose";
  }
  if (mark === "can't check") return "can't tell from here";
  return "unknown";
}

export function shownMark(mark: string, stepId: string, nextId: string | null): string {
  if (nextId !== null && stepId === nextId) return "next";
  if (mark === "next" && nextId !== null && stepId !== nextId) return "to do";
  return mark;
}

export function secretFolders(places: string[]): { folder: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const p of places) {
    const idx = p.lastIndexOf("/");
    const folder = idx === -1 ? "./" : p.slice(0, idx + 1);
    if (!counts.has(folder)) {
      counts.set(folder, 1);
      order.push(folder);
    } else {
      counts.set(folder, (counts.get(folder) as number) + 1);
    }
  }
  return order.map((folder) => ({ folder, count: counts.get(folder) as number }));
}

const FILE_FOR_STEP: Record<string, (path: string) => boolean> = {
  rules: (path) => path === "AGENTS.md",
  templates: (path) => path.startsWith(".github/ISSUE_TEMPLATE/") || path === ".github/pull_request_template.md",
  codeowners: (path) => path === ".github/CODEOWNERS",
  "security-files": (path) => path === ".github/SECURITY.md" || path === ".github/dependabot.yml",
  changelog: (path) => path === "CHANGELOG.md",
};

export const INSTALL_COMMAND = "npx yokoten init";

function isFixedByFiles(step: { id: string; what?: string }, files: { path: string }[]): boolean {
  const matchesFile = FILE_FOR_STEP[step.id];
  if (!matchesFile || !files.some((file) => matchesFile(file.path))) return false;
  // No file here can add a license, so that check stays open after the files.
  if (step.id === "security-files" && (step.what ?? "").includes("no license")) return false;
  return true;
}

export function nextAction(
  next: { id: string; what?: string },
  installOnly: { id: string }[],
  files: { path: string }[],
  owner: string,
  repo: string,
  isWaiting: boolean,
  options: { gain?: number; handIds?: string[] } = {},
): { label: string; href: string; opensChart: boolean } {
  const seeHow = { label: "See how", href: `#check-${next.id}`, opensChart: true };
  if (isWaiting) return seeHow;
  if (next.id === "issues") {
    return { label: "Open repo settings", href: `https://github.com/${owner}/${repo}/settings`, opensChart: false };
  }
  if (installOnly.some((step) => step.id === next.id)) {
    return { label: "Install yokoten", href: "#install", opensChart: false };
  }
  if (isFixedByFiles(next, files)) {
    const label = options.gain === 0 ? "Get the file" : "Get the files";
    return { label, href: "#files", opensChart: false };
  }
  if (options.handIds?.includes(next.id)) {
    return { label: "See how", href: "#hand", opensChart: false };
  }
  return seeHow;
}

export function splitErrorCommand(message: string): { text: string; command: string } {
  if (message.endsWith(": npx yokoten") || message.endsWith(": npx yokoten.")) {
    const idx = message.lastIndexOf(":");
    return { text: message.slice(0, idx + 1), command: "npx yokoten" };
  }
  return { text: message, command: "" };
}

function handBase(id: string): HandItem {
  return { id, title: "", wrong: "", list: [], command: "", after: "" };
}

function buildHandItem(step: { id: string; title: string; what?: string; fix?: string }, installStepNumber: number, importInfo: { file: string; line: string } | null): HandItem {
  if (step.id === "no-build-output") {
    const m = (step.what ?? "").match(/\(([^)]*)\)/);
    const inner = m ? m[1] : "";
    const paths = inner ? inner.split(", ") : [];
    const isWhole = paths.length > 0 && !paths.some((p) => /^and \d+ more$/.test(p));
    if (isWhole) {
      return { id: step.id, title: "Keep build output out of git", wrong: "Build output is in the repo.", list: [], command: "git rm --cached " + paths.join(" "), after: "Then add dist/, build/, out/ to .gitignore." };
    }
    return { id: step.id, title: "Keep build output out of git", wrong: "Build output is in the repo.", list: paths, command: "", after: "Remove it with `git rm --cached` and add dist/, build/, out/ to .gitignore." };
  }
  if (step.id === "changelog" && (step.fix ?? "").includes("`yokoten init`")) {
    return { id: step.id, title: step.title, wrong: toSentence(step.what ?? ""), list: [], command: INSTALL_COMMAND, after: "It adds both. Then each pull request adds a file in changes/ for each change that users notice." };
  }
  if (step.id === "tests" && (step.fix ?? "").includes("`yokoten init`")) {
    const fix = step.fix ?? "";
    if (installStepNumber > 0) {
      const rest = fix.replace(/^run `yokoten init` to add ([^,]+), then in it, /, `The command in Step ${installStepNumber} adds $1. In that file, `);
      return { id: step.id, title: step.title, wrong: "CI does not run the tests yet. This does not mean they fail.", list: [], command: "", after: toSentence(rest) };
    }
    const rest = fix.replace(/^run `yokoten init` to add ([^,]+), then in it, /, "It adds $1. In that file, ");
    return { id: step.id, title: step.title, wrong: "CI does not run the tests yet. This does not mean they fail.", list: [], command: INSTALL_COMMAND, after: toSentence(rest) };
  }
  if (step.id === "import") {
    const file = importInfo?.file ?? "";
    const line = importInfo?.line ?? "";
    return { id: step.id, title: `Add one line to ${file}`, wrong: "Claude Code won't read the new rules until it does.", list: [], command: line, after: "" };
  }
  if (step.id === "security-files" && (step.fix ?? "").includes("choose a license")) {
    return { id: step.id, title: "Add a license", wrong: "No license file.", list: [], command: "", after: "Choose a license and add it as LICENSE." };
  }
  return { id: step.id, title: step.title, wrong: toSentence(step.what ?? ""), list: [], command: "", after: toSentence(step.fix ?? "") };
}

export function resultPlan(result: CheckResult, fixes: FixesPayload | null, isWaiting: boolean): ResultPlan {
  const summary = result.summary ?? {};
  const done = summary.done ?? 0;
  const total = summary.total ?? 0;
  const steps = summary.steps ?? [];
  const installOnly = summary.install_only ?? summary.installOnly ?? [];
  const installIds = new Set(installOnly.map((s) => s.id));
  const files = fixes?.files ?? [];
  const isLost = fixes?.muse === "lost";
  const isFailed = fixes?.muse === "failed";
  const isAfterKnown = !!fixes?.after;
  const afterDone = fixes?.after?.done ?? done;
  const gain = Math.max(0, afterDone - done);
  const countedHand = isAfterKnown ? total - done - gain - installOnly.length : 0;
  const open = steps.filter((s) => s.mark !== "done" && !installIds.has(s.id));
  const handSteps = open.filter((step) => !isFixedByFiles(step, files));
  const rulesOpen = open.find((s) => s.id === "rules") ?? null;
  let importInfo: { file: string; line: string } | null = null;
  if (fixes?.claude_import && rulesOpen && countedHand > handSteps.length) {
    importInfo = fixes.claude_import;
    handSteps.push({ ...rulesOpen, id: "import" });
  }
  const counted = handSteps.slice(0, Math.max(0, countedHand));
  const isDoneByInstall = (step: { fix?: string }): boolean => {
    const fix = step.fix ?? "";
    return /^(?:run )?`yokoten init` (?:adds|writes|to add)\b/.test(fix) && !fix.includes("then in it") && !fix.includes("choose a license");
  };
  const movedToInstall = isAfterKnown && installOnly.length > 0 ? counted.filter(isDoneByInstall) : [];
  const movedIds = new Set(movedToInstall.map((s) => s.id));
  const remaining = counted.filter((s) => !movedIds.has(s.id));
  const installSteps = [...installOnly, ...movedToInstall];
  const nInstall = installSteps.length;
  const handCount = Math.max(0, countedHand - movedToInstall.length);
  const isHandListShort = remaining.length < handCount;
  const segments: string[] = [];
  for (let i = 0; i < total; i++) {
    if (i < done) segments.push("s-done");
    else if (i < done + gain) segments.push("s-files");
    else if (i < done + gain + nInstall) segments.push("s-install");
    else if (isAfterKnown) segments.push("s-hand");
    else segments.push("");
  }
  const legend: { swatch: string; text: string }[] = [];
  if (isAfterKnown) {
    legend.push({ swatch: "s-done", text: `${done} pass` });
    if (gain > 0) legend.push({ swatch: "s-files", text: `+${gain} with files` });
    if (nInstall > 0) legend.push({ swatch: "s-install", text: `+${nInstall} with yokoten` });
    if (handCount > 0) legend.push({ swatch: "s-hand", text: `+${handCount} by hand` });
  }
  const filesBlock: FilesBlock = !fixes ? "waiting" : isLost ? "lost" : isFailed || files.length > 0 ? "list" : nInstall > 0 ? "hidden" : "nothing";
  const owner = String(result.owner ?? "");
  const repo = String(result.repo ?? "");
  const next = summary.next ?? null;
  const action: PlanAction | null = !next ? null : { ...nextAction(next, installSteps, files, owner, repo, isWaiting || !fixes || isLost, { gain, handIds: remaining.map((step) => step.id) }), isQuiet: isLost };
  const hrefMap: Record<string, StepKey> = { "#files": "files", "#install": "install", "#hand": "hand" };
  const lead: StepKey | undefined = hrefMap[action?.href ?? ""];
  const filesEarly = filesBlock === "waiting" || filesBlock === "lost" || (filesBlock === "list" && gain > 0);
  const filesAreStep = filesBlock !== "hidden" && filesBlock !== "nothing" && (filesEarly || lead === "files");
  const base: StepKey[] = filesAreStep ? ["files", "install", "hand"] : ["install", "hand"];
  const sorted: StepKey[] = lead && base.includes(lead) ? [lead, ...base.filter((s) => s !== lead)] : base;
  const stepOrder: StepKey[] = sorted.filter((step) => {
    if (step === "files") return true;
    if (step === "install") return nInstall > 0;
    if (step === "hand") return handCount > 0;
    return false;
  });
  const idx = stepOrder.indexOf("install");
  const installStepNumber = idx === -1 ? 0 : idx + 1;
  const handItems = remaining.map((step) => buildHandItem(step as { id: string; title: string; what?: string; fix?: string }, installStepNumber, importInfo));
  const handTitle = remaining.length === 1 && !isHandListShort ? remaining[0].title : handCount === 1 ? "Fix 1 by hand" : `Fix these ${handCount} by hand`;
  const filesTitle = (() => {
    if (filesBlock === "waiting") return "Get your files";
    if (filesBlock === "lost") return "Your files didn't arrive";
    if (filesBlock === "nothing") return "Nothing to add";
    if (filesBlock === "hidden") return "";
    if (files.length === 0) return "Your files";
    const n = files.length;
    if (gain > 0 || lead === "files") return n === 1 ? "Add 1 file" : `Add ${n} files`;
    return n === 1 ? "Add 1 more file if you want" : `Add ${n} more files if you want`;
  })();
  return {
    done,
    total,
    isAfterKnown,
    afterDone,
    gain,
    installSteps,
    movedToInstall,
    handCount,
    handItems,
    isHandListShort,
    segments,
    legend,
    action,
    filesBlock,
    filesTitle,
    filesAreStep,
    stepOrder,
    installStepNumber,
    handTitle,
  };
}

export function resultCommands(plan: ResultPlan): string[] {
  const out: string[] = [];
  if (plan.installStepNumber > 0) out.push(INSTALL_COMMAND);
  for (const item of plan.handItems) {
    if (item.command) out.push(item.command);
  }
  return out;
}

export function viewModel(result: CheckResult): ViewModel {
  const summary = (result.summary ?? {}) as NonNullable<CheckResult["summary"]>;
  const done = summary.done ?? 0;
  const total = summary.total ?? 0;
  const nextRaw = summary.next ?? null;
  const steps = summary.steps ?? [];
  const installOnlyRaw = summary.install_only ?? summary.installOnly ?? [];

  const scoreText = `${done} of ${total} file checks pass`;
  let headline = `${done} of ${total} file checks pass`;
  let next: ViewModel["next"] = null;
  if (nextRaw) {
    headline += ` · fix this first: ${nextRaw.title}`;
    next = {
      title: nextRaw.title,
      id: nextRaw.id,
      what: nextRaw.what,
      why: nextRaw.why,
      fix: nextRaw.fix,
      how: nextRaw.how,
      docs: nextRaw.docs,
    };
  }

  const installOnlyIds = new Set(installOnlyRaw.map((s) => s.id));
  const nextId = next ? next.id : null;

  const others: ViewModel["others"] = [];
  for (const s of steps) {
    if (nextId && s.id === nextId) continue;
    if (installOnlyIds.has(s.id)) continue;
    const label = markLabel(s.mark, s.reason);
    others.push({
      id: s.id,
      title: s.title,
      mark: s.mark,
      how: s.how,
      why: s.why,
      what: s.what,
      fix: s.fix,
      docs: s.docs,
      reason: s.reason,
      label,
    });
  }

  const installOnly = installOnlyRaw.map((s) => ({
    id: s.id,
    title: s.title,
    mark: s.mark,
    how: s.how,
    why: s.why,
    what: s.what,
    fix: s.fix,
    docs: s.docs,
    reason: s.reason,
  }));

  const rawSecrets = result.secrets ?? [];
  const secretCount = rawSecrets.length;
  const groupsMap = new Map<string, { what?: string; why?: string; fix?: string; places: string[] }>();
  for (const s of rawSecrets) {
    const id = s.id;
    const filePart = s.file ?? "";
    const linePart = s.line != null && s.line !== "" ? String(s.line) : "";
    let place = "";
    if (filePart && linePart) place = `${filePart}:${linePart}`;
    else if (filePart) place = filePart;
    else if (linePart) place = `:${linePart}`;
    else place = "";
    if (!groupsMap.has(id)) {
      groupsMap.set(id, {
        what: s.what,
        why: s.why,
        fix: s.fix,
        places: [place],
      });
    } else {
      const g = groupsMap.get(id);
      if (g) g.places.push(place);
    }
  }
  const secretGroups = Array.from(groupsMap.values());

  const version = (result.yokoten_version as string | undefined) ?? (result.version as string | undefined) ?? "";
  const commit = (result.commit as string | undefined) ?? "";
  const shortCommit = commit ? commit.slice(0, 7) : "";
  const rerun = (result.rerun as Rerun | undefined) ?? {};
  const doctorCommand = rerun.doctor ?? "";
  const checkCommand = rerun.check ?? "";

  return {
    headline,
    score: { done, total, text: scoreText },
    next,
    others,
    installOnly,
    secretGroups,
    secretCount,
    evidence: { version, commit, shortCommit, doctorCommand, checkCommand },
  };
}
