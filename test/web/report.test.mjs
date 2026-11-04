import { test } from "node:test";
import assert from "node:assert/strict";
import { readReportReply, evidenceHref, severityLabel, reportFileName, REPORT_FALLBACK, countLine, reportRecordName, bundleFileName, bundleVerifyCommand } from "../../web/src/client/report.ts";

test("readReportReply done filters bad findings", () => {
  const body = {
    status: "done",
    owner: "o",
    repo: "r",
    commit: "c",
    cw_version: "v",
    model: "m",
    summary: "s",
    findings: [
      { severity: "P0", evidence: ["a.js:1"] },
      { severity: "P0", title: "good", evidence: ["a.js:1", 123], classification: "x" },
    ],
    markdown: "md",
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") {
    assert.equal(state.report.findings.length, 1);
    assert.equal(state.report.findings[0].title, "good");
    assert.deepEqual(state.report.findings[0].evidence, ["a.js:1"]);
  }
});

test("readReportReply working", () => {
  const state = readReportReply(200, { status: "working" });
  assert.equal(state.kind, "working");
});

test("readReportReply none gives idle", () => {
  const state = readReportReply(404, { status: "none" });
  assert.equal(state.kind, "idle");
});

test("readReportReply error with message", () => {
  const state = readReportReply(400, { status: "error", message: "oops" });
  assert.equal(state.kind, "failed");
  if (state.kind === "failed") assert.equal(state.message, "oops");
});

test("readReportReply failed reply", () => {
  const state = readReportReply(200, { status: "failed", message: "bad" });
  assert.equal(state.kind, "failed");
  if (state.kind === "failed") assert.equal(state.message, REPORT_FALLBACK);
});

test("readReportReply junk gives fallback", () => {
  const state = readReportReply(200, { status: "unknown" });
  assert.equal(state.kind, "failed");
  if (state.kind === "failed") assert.equal(state.message, REPORT_FALLBACK);
  const state2 = readReportReply(200, null);
  assert.equal(state2.kind, "failed");
});

test("evidenceHref valid link", () => {
  const href = evidenceHref("o", "r", "abc123", "lib/a@b.js:12");
  assert.ok(href);
  assert.ok(href.endsWith("/blob/abc123/lib/a%40b.js#L12"));
  assert.equal(href, "https://github.com/o/r/blob/abc123/lib/a%40b.js#L12");
});

test("evidenceHref invalid gives null", () => {
  assert.equal(evidenceHref("o", "r", "c", "/etc/passwd:1"), null);
  assert.equal(evidenceHref("o", "r", "c", "../a.js:1"), null);
  assert.equal(evidenceHref("o", "r", "c", "lib/a.js"), null);
  assert.equal(evidenceHref("o", "r", "c", "lib/a.js:x"), null);
});

test("severityLabel", () => {
  assert.equal(severityLabel("P0"), "Fix first");
  assert.equal(severityLabel("P1"), "High");
  assert.equal(severityLabel("P2"), "Medium");
  assert.equal(severityLabel("P3"), "Low");
  assert.equal(severityLabel("junk"), "Low");
});

test("reportFileName", () => {
  assert.equal(reportFileName("o", "r", "abcdef1234"), "review-o-r-abcdef1.md");
});

test("countLine no findings", () => {
  assert.equal(countLine([]), "No risks found.");
});

test("countLine one high", () => {
  assert.equal(countLine([{ severity: "P1", title: "t", evidence: [] }]), "1 risk: 1 high.");
});

test("countLine nine risks", () => {
  const findings = [
    { severity: "P0", title: "a", evidence: [] },
    { severity: "P1", title: "b", evidence: [] },
    { severity: "P1", title: "c", evidence: [] },
    { severity: "P1", title: "d", evidence: [] },
    { severity: "P1", title: "e", evidence: [] },
    { severity: "P1", title: "f", evidence: [] },
    { severity: "P2", title: "g", evidence: [] },
    { severity: "P2", title: "h", evidence: [] },
    { severity: "P2", title: "i", evidence: [] },
  ];
  assert.equal(countLine(findings), "9 risks: 1 fix first, 5 high, 3 medium.");
});

test("countLine low includes P3", () => {
  assert.equal(countLine([{ severity: "P3", title: "t", evidence: [] }]), "1 risk: 1 low.");
});

test("reportRecordName", () => {
  assert.equal(reportRecordName("abcdef1234567890"), "yokoten-doctor-report-abcdef123456.json");
});

test("readReportReply keeps good record", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    owner: "o",
    repo: "r",
    commit: "c",
    cw_version: "v",
    model: "m",
    markdown: "md",
    record: {
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      recorded_at: "2024-01-01T00:00:00Z",
      document: "{\"hello\":1}",
      rekor: { url: "https://example.com/rekor" },
      solana: null,
    },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") {
    assert.equal(state.report.record?.sha256, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(state.report.record?.document, "{\"hello\":1}");
    assert.deepEqual(state.report.record?.rekor, { url: "https://example.com/rekor" });
    assert.equal(state.report.record?.solana, null);
  }
});

test("readReportReply record without document gives null", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    record: { sha256: "abc" },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") assert.equal(state.report.record, null);
});

test("readReportReply record with empty sha256 gives null", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    record: { sha256: "", document: "{\"hello\":1}" },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") assert.equal(state.report.record, null);
});

test("readReportReply record with 64-hex sha256 and non-empty document is kept", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    record: {
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      recorded_at: "2024-01-01T00:00:00Z",
      document: "{\"hello\":1}",
    },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") {
    assert.equal(state.report.record?.sha256, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    assert.equal(state.report.record?.document, "{\"hello\":1}");
  }
});

test("readReportReply keeps a valid bundle", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    owner: "o",
    repo: "r",
    commit: "c",
    cw_version: "v",
    model: "m",
    markdown: "md",
    bundle: {
      sha256: "a".repeat(64),
      audit_head: "sha256:" + "b".repeat(64),
      size: 10,
      audit_events: 39,
      run_id: "architecture-review-fast-20261104T174110Z-442334",
      trust_level: "unsigned",
    },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") {
    assert.deepEqual(state.report.bundle, {
      sha256: "a".repeat(64),
      audit_head: "sha256:" + "b".repeat(64),
      size: 10,
      audit_events: 39,
      run_id: "architecture-review-fast-20261104T174110Z-442334",
      trust_level: "unsigned",
    });
  }
});

test("readReportReply bundle null when audit_head is nope", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    bundle: {
      sha256: "a".repeat(64),
      audit_head: "nope",
      size: 10,
      audit_events: 39,
      run_id: "architecture-review-fast-20261104T174110Z-442334",
      trust_level: "unsigned",
    },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") assert.equal(state.report.bundle, null);
});

test("readReportReply bundle null when size is 0", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    bundle: {
      sha256: "a".repeat(64),
      audit_head: "sha256:" + "b".repeat(64),
      size: 0,
      audit_events: 39,
      run_id: "architecture-review-fast-20261104T174110Z-442334",
      trust_level: "unsigned",
    },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") assert.equal(state.report.bundle, null);
});

test("readReportReply bundle null when run_id is a b", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
    bundle: {
      sha256: "a".repeat(64),
      audit_head: "sha256:" + "b".repeat(64),
      size: 10,
      audit_events: 39,
      run_id: "a b",
      trust_level: "unsigned",
    },
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") assert.equal(state.report.bundle, null);
});

test("readReportReply bundle null when missing", () => {
  const body = {
    status: "done",
    summary: "s",
    findings: [],
  };
  const state = readReportReply(200, body);
  assert.equal(state.kind, "done");
  if (state.kind === "done") assert.equal(state.report.bundle, null);
});

test("bundleFileName", () => {
  assert.equal(bundleFileName("o", "r", "0123456789abcdef"), "o-r-0123456.cwrun.json");
});

test("bundleVerifyCommand with version", () => {
  assert.equal(bundleVerifyCommand("0.4.1", "x.cwrun.json"), "npx -y -p cool-workflow@0.4.1 cw report verify-bundle x.cwrun.json");
});

test("bundleVerifyCommand without version", () => {
  assert.equal(bundleVerifyCommand("v", "x.cwrun.json"), "npx -y -p cool-workflow cw report verify-bundle x.cwrun.json");
});
