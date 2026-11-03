import type { UnderstoodSection } from "./types.ts";

export const MAX_GITHUB_LINK = 6000;

export function isSafePath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0) return false;
  if (path.includes("\\")) return false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  const parts = path.split("/");
  for (const p of parts) {
    if (p === "" || p === "." || p === "..") return false;
  }
  return true;
}

export function newFileLink(owner: string, repo: string, branch: string | null, path: string, content: string | null): string {
  const b = branch == null ? "main" : branch;
  const encodedBranch = b.split("/").map(encodeURIComponent).join("/");
  let href =
    "https://github.com/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repo) +
    "/new/" +
    encodedBranch +
    "?filename=" +
    encodeURIComponent(path);
  if (content != null) {
    href += "&value=" + encodeURIComponent(content);
  }
  return href;
}

export function fileLinkPlan(owner: string, repo: string, branch: string | null, file: { path: string; content: string }): { kind: string; href: string } {
  const filled = newFileLink(owner, repo, branch, file.path, file.content);
  if (filled.length <= MAX_GITHUB_LINK) {
    return { kind: "filled", href: filled };
  }
  const href = newFileLink(owner, repo, branch, file.path, null);
  return { kind: "copy first", href };
}

export function rerunHref(owner: string, repo: string): string {
  return "/?repo=" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
}

export function savedCheckHref(owner: string, repo: string): string {
  return rerunHref(owner, repo) + "&saved=1";
}

export function repoFileHref(owner: string, repo: string, branch: string | null, kind: "blob" | "edit", path: string): string {
  const b = branch == null ? "main" : branch;
  const encodedBranch = b.split("/").map(encodeURIComponent).join("/");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + kind + "/" + encodedBranch + "/" + encodedPath;
}

export function claudeFileFromStep(what: string | undefined): { file: string; line: string } {
  if (what && what.includes(".claude/CLAUDE.md")) {
    return { file: ".claude/CLAUDE.md", line: "@../AGENTS.md" };
  }
  return { file: "CLAUDE.md", line: "@AGENTS.md" };
}

export function isClaudeFileLink(fix: string | undefined): boolean {
  return /^\S*CLAUDE\.md is a link to /.test(fix ?? "");
}

export function buildPatch(files: { path: string; content: string }[]): string {
  const safe = files.filter((f) => isSafePath(f.path));
  if (safe.length === 0) return "";
  let out = "";
  for (let i = 0; i < safe.length; i++) {
    const f = safe[i];
    const path = f.path;
    const content = f.content;
    out += `diff --git a/${path} b/${path}\n`;
    out += `new file mode 100644\n`;
    out += `--- /dev/null\n`;
    out += `+++ b/${path}\n`;
    if (content === "") {
    } else {
      const endsWithNewline = content.endsWith("\n");
      let lines = content.split("\n");
      if (endsWithNewline) {
        lines.pop();
      }
      out += `@@ -0,0 +1,${lines.length} @@\n`;
      for (const line of lines) {
        out += `+${line}\n`;
      }
      if (!endsWithNewline) {
        out += "\\ No newline at end of file\n";
      }
    }
  }
  return out;
}

export function orderFiles(files: { path: string; content: string; source?: string }[]): { first: { path: string; content: string; source?: string } | null; rest: { path: string; content: string; source?: string }[] } {
  const safe = files.filter((f) => isSafePath(f.path));
  if (safe.length === 0) return { first: null, rest: [] };
  let firstIdx = safe.findIndex((f) => f.path === "AGENTS.md");
  if (firstIdx === -1) firstIdx = 0;
  const first = safe[firstIdx];
  const rest = safe.filter((_, idx) => idx !== firstIdx);
  return { first, rest };
}

export const PATCH_COMMANDS = [
  "git switch -c yokoten-doctor-fixes",
  "git apply --index yokoten-doctor.patch",
  'git commit -m "docs: add agent rules from yokoten doctor"',
  "git push -u origin yokoten-doctor-fixes",
  "gh pr create --fill",
].join("\n");

export function recordView(record: unknown): { sha256: string; recordedAt: string; documentName: string; documentText: string; verifyCommand: string; rekorUrl: string | null; solanaUrl: string | null; message: string } | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;
  const sha256 = r.sha256;
  const recordedAt = r.recorded_at;
  const documentText = r.document;
  if (typeof sha256 !== "string" || typeof recordedAt !== "string" || typeof documentText !== "string") return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const documentName = `yokoten-doctor-${sha256.slice(0, 12)}.json`;
  const verifyCommand = `sha256sum ${documentName}`;
  let rekorUrl: string | null = null;
  let solanaUrl: string | null = null;
  if (r.rekor && typeof r.rekor === "object") {
    const rekor = r.rekor as Record<string, unknown>;
    if (typeof rekor.url === "string" && rekor.url.startsWith("https://search.sigstore.dev/")) {
      rekorUrl = rekor.url;
    }
  }
  if (r.solana && typeof r.solana === "object") {
    const solana = r.solana as Record<string, unknown>;
    if (typeof solana.url === "string" && solana.url.startsWith("https://explorer.solana.com/") && solana.url.endsWith("?cluster=devnet")) {
      solanaUrl = solana.url;
    }
  }
  let message = "";
  if (rekorUrl && solanaUrl) {
    message = "";
  } else if (rekorUrl && !solanaUrl) {
    message = "The devnet record couldn't be written this time.";
  } else if (!rekorUrl) {
    message = "The public record couldn't be written this time. The check still ran.";
  }
  return { sha256, recordedAt, documentName, documentText, verifyCommand, rekorUrl, solanaUrl, message };
}

export function projectSection(content: string): string {
  if (typeof content !== "string") return "";
  const lines = content.split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## This project") {
      idx = i;
      break;
    }
  }
  if (idx === -1) return "";
  const out = lines.slice(idx).join("\n").trim();
  return out;
}

const SAVED_FILE_TITLE = "# How to work on this project";
const EMPTY_SAVED_FILE = "## Build\n\nWrite how to build this project.\n\n## Test\n\nWrite how to test it.\n\n## What not to touch\n\nWrite what an AI must not change.";

export function savedFileText(content: string, isWrittenByAi: boolean): string {
  const lines = isWrittenByAi ? projectSection(content).split("\n").slice(1) : [];
  const body = lines.map((line) => (line.startsWith("### ") ? line.slice(1) : line)).join("\n").trim();
  return `${SAVED_FILE_TITLE}\n\n${body || EMPTY_SAVED_FILE}\n`;
}

export function understoodSections(content: string): UnderstoodSection[] | null {
  const section = projectSection(content);
  if (!section) return null;
  const lines = section.split("\n");
  const parts: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const raw of lines) {
    if (raw.startsWith("### ")) {
      if (current) parts.push(current);
      current = { heading: raw.slice(4).trim(), lines: [] };
    } else if (current) {
      const t = raw.trim();
      if (!t) continue;
      if (t.startsWith("```")) continue;
      let v = t;
      if (v.startsWith("- ")) v = v.slice(2);
      current.lines.push(v);
    } else {
      const t = raw.trim();
      if (!t) continue;
      if (t === "## This project") continue;
      return null;
    }
  }
  if (current) parts.push(current);
  let build: string[] | null = null;
  let test: string[] | null = null;
  let touch: string[] | null = null;
  for (const p of parts) {
    const h = p.heading.toLowerCase();
    if (h.includes("touch")) {
      if (touch !== null) return null;
      touch = p.lines;
    } else if (h.includes("build")) {
      if (build !== null) return null;
      build = p.lines;
    } else if (h.includes("test")) {
      if (test !== null) return null;
      test = p.lines;
    } else {
      return null;
    }
  }
  if (!build || build.length === 0 || !test || test.length === 0 || !touch || touch.length === 0) return null;
  return [
    { title: "How to build it", lines: build },
    { title: "How to test it", lines: test },
    { title: "What not to touch", lines: touch },
  ];
}
