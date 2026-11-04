import { make, createLink, createCommandBox, createIcon } from "./dom.ts";
import { readReportReply, evidenceHref, severityLabel, reportFileName, REPORT_FALLBACK, countLine, reportRecordName } from "../report.ts";
import type { ReportDone, ReportRecord } from "../report.ts";

const cache = new Map<string, HTMLElement>();

function renderRecord(record: ReportRecord | null | undefined): HTMLElement {
  const block = make("div", "report-record");
  const h3 = make("h3", undefined, "On public record");
  block.appendChild(h3);
  const hasRekor = !!(record && record.rekor && typeof record.rekor.url === "string" && record.rekor.url !== "");
  const hasSolana = !!(record && record.solana && typeof record.solana.url === "string" && record.solana.url !== "");
  if (!record || (!hasRekor && !hasSolana)) {
    const p = make("p", undefined, "No public record for this report.");
    block.appendChild(p);
    return block;
  }
  const intro = make("p", undefined, "This report has its own record, linked to the check's. It shows the report wasn't changed, not that it's right.");
  block.appendChild(intro);
  const ol = make("ol", "steps-n");
  const liOne = make("li");
  const pOne = make("p", undefined, "Download the record.");
  liOne.appendChild(pOne);
  const actions = make("div", "save-actions");
  const dl = make("button", "btn btn-line ctl", "Download");
  dl.type = "button";
  dl.addEventListener("click", () => {
    const blob = new Blob([record.document], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = reportRecordName(record.sha256);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  actions.appendChild(dl);
  liOne.appendChild(actions);
  ol.appendChild(liOne);
  const liTwo = make("li");
  const pTwo = make("p", undefined, "Hash it.");
  liTwo.appendChild(pTwo);
  liTwo.appendChild(createCommandBox(`sha256sum ${reportRecordName(record.sha256)}`));
  ol.appendChild(liTwo);
  const liThree = make("li");
  const pThree = make("p", undefined, "It must match:");
  liThree.appendChild(pThree);
  liThree.appendChild(createCommandBox(record.sha256));
  if (hasRekor) {
    const link = createLink(record.rekor!.url, "See it on Sigstore Rekor");
    link.classList.add("link", "ctl");
    link.appendChild(document.createTextNode(" "));
    link.appendChild(createIcon("out"));
    liThree.appendChild(link);
  }
  if (hasSolana) {
    const link = createLink(record.solana!.url, "Solana devnet memo (test network)");
    link.classList.add("link", "ctl");
    link.appendChild(document.createTextNode(" "));
    link.appendChild(createIcon("out"));
    liThree.appendChild(link);
  }
  ol.appendChild(liThree);
  block.appendChild(ol);
  if ((hasRekor ? 1 : 0) + (hasSolana ? 1 : 0) === 1) {
    const last = make("p", undefined, "Part of the record was written. The hash still checks the report.");
    block.appendChild(last);
  }
  return block;
}

export function getReportSection(input: { api: string; owner: string; repo: string; commit: string }): HTMLElement {
  const key = `${input.owner}/${input.repo}@${input.commit}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const section = make("section", "f-report");
  section.id = "report";
  let state: { kind: "idle" } | { kind: "working" } | { kind: "done"; report: ReportDone } | { kind: "failed"; message: string } = { kind: "idle" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startTime = 0;
  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function renderIdle() {
    const h2 = make("h2", undefined, "Get a review report");
    section.appendChild(h2);
    const p = make("p", undefined, "Muse lists the risks an AI agent should know here. Each one links to a line of code. About a minute.");
    section.appendChild(p);
    const actions = make("div", "save-actions");
    const btn = make("button", "btn btn-primary ctl", "Get the report");
    btn.setAttribute("data-report-start", "");
    btn.type = "button";
    btn.addEventListener("click", () => {
      void startReport();
    });
    actions.appendChild(btn);
    section.appendChild(actions);
  }
  function renderWorking() {
    const h2 = make("h2", undefined, "Get a review report");
    section.appendChild(h2);
    const p = make("p", "report-working", "Writing the report. About a minute.");
    p.setAttribute("aria-live", "polite");
    section.appendChild(p);
  }
  function renderDone(report: ReportDone) {
    const h2 = make("h2", undefined, "Review report");
    section.appendChild(h2);
    const summary = make("p", "report-summary", countLine(report.findings));
    section.appendChild(summary);
    if (report.findings.length > 0) {
      const ol = make("ol", "report-list");
      for (const f of report.findings) {
        const li = make("li");
        const sev = make("span", "report-sev", severityLabel(f.severity));
        sev.setAttribute("data-sev", f.severity);
        li.appendChild(sev);
        const title = make("span", "report-title", f.title);
        li.appendChild(title);
        const links: HTMLElement[] = [];
        for (const ev of f.evidence) {
          const href = evidenceHref(input.owner, input.repo, input.commit, ev);
          if (!href) continue;
          const a = createLink(href, ev);
          links.push(a as HTMLElement);
        }
        if (links.length > 0) {
          const pEv = make("p", "report-evidence");
          for (const a of links) pEv.appendChild(a);
          li.appendChild(pEv);
        }
        ol.appendChild(li);
      }
      section.appendChild(ol);
    }
    const note = make("p", "report-note", `Made with cool-workflow ${report.cw_version} and Muse. It ran no code. AI can be wrong, so check each line.`);
    section.appendChild(note);
    const actions = make("div", "save-actions");
    const dl = make("button", "btn btn-line ctl", "Download (Markdown)");
    dl.setAttribute("data-report-download", "");
    dl.type = "button";
    dl.addEventListener("click", () => {
      const blob = new Blob([report.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFileName(input.owner, input.repo, input.commit);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
    actions.appendChild(dl);
    section.appendChild(actions);
    const recordBlock = renderRecord(report.record ?? null);
    section.appendChild(recordBlock);
  }
  function renderFailed(message: string) {
    const h2 = make("h2", undefined, "Get a review report");
    section.appendChild(h2);
    const p = make("p", "report-failed", message);
    section.appendChild(p);
    const actions = make("div", "save-actions");
    const btn = make("button", "btn btn-primary ctl", "Try again");
    btn.setAttribute("data-report-start", "");
    btn.type = "button";
    btn.addEventListener("click", () => {
      void startReport();
    });
    actions.appendChild(btn);
    section.appendChild(actions);
  }
  function render() {
    while (section.firstChild) section.removeChild(section.firstChild);
    if (state.kind === "idle") renderIdle();
    else if (state.kind === "working") renderWorking();
    else if (state.kind === "done") renderDone(state.report);
    else if (state.kind === "failed") renderFailed(state.message);
  }
  function setState(next: typeof state) {
    clearTimer();
    state = next;
    render();
    if (state.kind === "working") {
      if (startTime === 0) startTime = Date.now();
      if (Date.now() - startTime >= 15 * 60 * 1000) {
        state = { kind: "failed", message: REPORT_FALLBACK };
        startTime = 0;
        render();
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, 4000);
    } else {
      startTime = 0;
    }
  }
  async function startReport() {
    setState({ kind: "working" });
    try {
      const resp = await fetch(input.api + "/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: input.owner, repo: input.repo, commit: input.commit }),
      });
      let body: unknown = {};
      try {
        body = await resp.json();
      } catch {
        body = {};
      }
      const next = readReportReply(resp.status, body);
      setState(next);
    } catch {
      setState({ kind: "failed", message: REPORT_FALLBACK });
    }
  }
  async function poll() {
    if (Date.now() - startTime >= 15 * 60 * 1000) {
      setState({ kind: "failed", message: REPORT_FALLBACK });
      return;
    }
    try {
      const url = `${input.api}/api/report?owner=${encodeURIComponent(input.owner)}&repo=${encodeURIComponent(input.repo)}&commit=${encodeURIComponent(input.commit)}`;
      const resp = await fetch(url);
      let body: unknown = {};
      try {
        body = await resp.json();
      } catch {
        body = {};
      }
      const next = readReportReply(resp.status, body);
      if (next.kind === "idle") {
        setState({ kind: "failed", message: REPORT_FALLBACK });
        return;
      }
      setState(next);
    } catch {
      setState({ kind: "failed", message: REPORT_FALLBACK });
    }
  }
  async function initialGet() {
    try {
      const url = `${input.api}/api/report?owner=${encodeURIComponent(input.owner)}&repo=${encodeURIComponent(input.repo)}&commit=${encodeURIComponent(input.commit)}`;
      const resp = await fetch(url);
      let body: unknown = {};
      try {
        body = await resp.json();
      } catch {
        body = {};
      }
      const next = readReportReply(resp.status, body);
      if (next.kind === "done") {
        setState(next);
      }
    } catch {
    }
  }
  render();
  void initialGet();
  cache.set(key, section);
  return section;
}
