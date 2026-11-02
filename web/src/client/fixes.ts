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

export function isFilesSectionHidden(fixes: { files?: { path: string }[]; muse: string } | null, hasOpenInstallOnly: boolean): boolean {
  if (!fixes) return false;
  if (fixes.muse === "failed" || fixes.muse === "lost") return false;
  const hasFiles = !!(fixes.files && fixes.files.length > 0);
  if (hasFiles) return false;
  if (!hasOpenInstallOnly) return false;
  return true;
}

export function rerunHref(owner: string, repo: string): string {
  return "/?repo=" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
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

export function claudeImportMessage(fixes: { claude_import?: { file: string; line: string } | null }): string {
  if (fixes && fixes.claude_import && fixes.claude_import.file && fixes.claude_import.line) {
    return `Your repo already has ${fixes.claude_import.file}. Add this line to it so Claude Code picks up the new rules: ${fixes.claude_import.line}`;
  }
  return "";
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
