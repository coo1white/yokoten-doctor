import { test } from "node:test";
import assert from "node:assert/strict";
import { readReportReply, evidenceHref, severityLabel, reportFileName, REPORT_FALLBACK } from "../../web/src/client/report.ts";

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
  if (state.kind === "failed") assert.equal(state.message, "bad");
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
