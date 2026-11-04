export type ReportFinding = { severity: string; title: string; classification?: string; evidence: string[] };
export type ReportDone = { status: "done"; owner: string; repo: string; commit: string; cw_version: string; model: string; summary: string; findings: ReportFinding[]; markdown: string };
export type ReportState = { kind: "idle" } | { kind: "working" } | { kind: "done"; report: ReportDone } | { kind: "failed"; message: string };

export const REPORT_FALLBACK = "The report couldn't finish. Try again in a few minutes.";

export function readReportReply(status: number, body: unknown): ReportState {
  if (body !== null && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.status === "done" && typeof b.summary === "string" && Array.isArray(b.findings)) {
      const findings: ReportFinding[] = [];
      for (const f of b.findings) {
        if (f !== null && typeof f === "object") {
          const fo = f as Record<string, unknown>;
          if (typeof fo.title === "string" && typeof fo.severity === "string" && Array.isArray(fo.evidence)) {
            const evidence = (fo.evidence as unknown[]).filter((e) => typeof e === "string") as string[];
            const finding: ReportFinding = { severity: fo.severity, title: fo.title, evidence };
            if (typeof fo.classification === "string") finding.classification = fo.classification;
            findings.push(finding);
          }
        }
      }
      const report: ReportDone = {
        status: "done",
        owner: typeof b.owner === "string" ? b.owner : "",
        repo: typeof b.repo === "string" ? b.repo : "",
        commit: typeof b.commit === "string" ? b.commit : "",
        cw_version: typeof b.cw_version === "string" ? b.cw_version : "",
        model: typeof b.model === "string" ? b.model : "",
        summary: b.summary,
        findings,
        markdown: typeof b.markdown === "string" ? b.markdown : "",
      };
      return { kind: "done", report };
    }
    if (b.status === "working") return { kind: "working" };
    if (b.status === "none") return { kind: "idle" };
    if ((b.status === "error" || b.status === "failed") && typeof b.message === "string") {
      return { kind: "failed", message: b.message };
    }
  }
  return { kind: "failed", message: REPORT_FALLBACK };
}

export function evidenceHref(owner: string, repo: string, commit: string, evidence: string): string | null {
  if (evidence.startsWith("/")) return null;
  if (evidence.split("/").includes("..")) return null;
  const m = evidence.match(/^([A-Za-z0-9_.@+/-]{1,200}):([0-9]{1,6})$/);
  if (!m) return null;
  const path = m[1];
  const line = m[2];
  const encoded = path.split("/").map((s) => encodeURIComponent(s)).join("/");
  return `https://github.com/${owner}/${repo}/blob/${commit}/${encoded}#L${line}`;
}

export function severityLabel(severity: string): string {
  if (severity === "P0") return "Fix first";
  if (severity === "P1") return "High";
  if (severity === "P2") return "Medium";
  return "Low";
}

export function reportFileName(owner: string, repo: string, commit: string): string {
  return `review-${owner}-${repo}-${commit.slice(0, 7)}.md`;
}
