export type ReportFinding = { severity: string; title: string; classification?: string; evidence: string[] };
export type ReportRecord = { sha256: string; recorded_at: string; document: string; check_sha256?: string | null; rekor?: { url: string } | null; solana?: { url: string } | null };
export type ReportBundle = { sha256: string; size: number; run_id: string; audit_head: string; audit_events: number; trust_level: string };
export type ReportDone = { status: "done"; owner: string; repo: string; commit: string; cw_version: string; model: string; summary: string; findings: ReportFinding[]; markdown: string; record?: ReportRecord | null; bundle?: ReportBundle | null };
export type ReportState = { kind: "idle" } | { kind: "working" } | { kind: "done"; report: ReportDone } | { kind: "failed"; message: string };

export const REPORT_FALLBACK = "The report didn't finish. Try again in a few minutes.";

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
      let record: ReportRecord | null = null;
      if (b.record !== null && typeof b.record === "object") {
        const r = b.record as Record<string, unknown>;
        if (typeof r.sha256 === "string" && r.sha256 !== "" && /^[0-9a-f]{64}$/.test(r.sha256) && typeof r.document === "string" && r.document !== "") {
          const rec: ReportRecord = {
            sha256: r.sha256,
            recorded_at: typeof r.recorded_at === "string" ? r.recorded_at : "",
            document: r.document,
          };
          if (typeof r.check_sha256 === "string") rec.check_sha256 = r.check_sha256;
          else if (r.check_sha256 === null) rec.check_sha256 = null;
          let rekor: { url: string } | null = null;
          if (r.rekor !== null && typeof r.rekor === "object") {
            const ro = r.rekor as Record<string, unknown>;
            if (typeof ro.url === "string") rekor = { url: ro.url };
          }
          rec.rekor = rekor;
          let solana: { url: string } | null = null;
          if (r.solana !== null && typeof r.solana === "object") {
            const so = r.solana as Record<string, unknown>;
            if (typeof so.url === "string") solana = { url: so.url };
          }
          rec.solana = solana;
          record = rec;
        }
      }
      let bundle: ReportBundle | null = null;
      if (b.bundle !== null && typeof b.bundle === "object") {
        const bo = b.bundle as Record<string, unknown>;
        if (
          typeof bo.sha256 === "string" && /^[0-9a-f]{64}$/.test(bo.sha256) &&
          typeof bo.audit_head === "string" && /^sha256:[0-9a-f]{64}$/.test(bo.audit_head) &&
          typeof bo.size === "number" && Number.isInteger(bo.size) && bo.size > 0 &&
          typeof bo.audit_events === "number" && Number.isInteger(bo.audit_events) && bo.audit_events > 0 &&
          typeof bo.run_id === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(bo.run_id)
        ) {
          bundle = {
            sha256: bo.sha256,
            size: bo.size,
            run_id: bo.run_id,
            audit_head: bo.audit_head,
            audit_events: bo.audit_events,
            trust_level: typeof bo.trust_level === "string" ? bo.trust_level : "unsigned",
          };
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
        record,
        bundle,
      };
      return { kind: "done", report };
    }
    if (b.status === "working") return { kind: "working" };
    if (b.status === "none") return { kind: "idle" };
    if (b.status === "failed") return { kind: "failed", message: REPORT_FALLBACK };
    if (b.status === "error" && typeof b.message === "string") {
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

export function countLine(findings: ReportFinding[]): string {
  if (findings.length === 0) return "No risks found.";
  const total = findings.length;
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  let low = 0;
  for (const f of findings) {
    if (f.severity === "P0") p0++;
    else if (f.severity === "P1") p1++;
    else if (f.severity === "P2") p2++;
    else low++;
  }
  const parts: string[] = [];
  if (p0 > 0) parts.push(`${p0} fix first`);
  if (p1 > 0) parts.push(`${p1} high`);
  if (p2 > 0) parts.push(`${p2} medium`);
  if (low > 0) parts.push(`${low} low`);
  const word = total === 1 ? "risk" : "risks";
  return `${total} ${word}: ${parts.join(", ")}.`;
}

export function reportRecordName(sha256: string): string {
  return `yokoten-doctor-report-${sha256.slice(0, 12)}.json`;
}

export function bundleFileName(owner: string, repo: string, commit: string): string {
  return `${owner}-${repo}-${commit.slice(0, 7)}.cwrun.json`;
}

export function bundleVerifyCommand(cwVersion: string, fileName: string): string {
  const pkg = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(cwVersion) ? `cool-workflow@${cwVersion}` : "cool-workflow";
  return `npx -y -p ${pkg} cw report verify-bundle ${fileName}`;
}
