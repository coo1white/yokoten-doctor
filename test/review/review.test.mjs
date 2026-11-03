import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer, decideEvent, cleanText, buildReviewBody, splitSavedData, isApprovedByPerson, holdForDecision, isClearedByLead, clearLine, LEAD_LOGIN, MAX_TEXT_CHARS, MAX_FINDINGS } from "../../.github/review/review.mjs";

describe("parseAnswer", () => {
  it("parses a good object", () => {
    const obj = { summary: "looks good", findings: [{ severity: "low", text: "minor" }] };
    const res = parseAnswer(JSON.stringify(obj));
    assert.deepEqual(res, obj);
  });
  it("parses a fenced object", () => {
    const obj = { summary: "ok", findings: [] };
    const fenced = "```json\n" + JSON.stringify(obj) + "\n```";
    assert.deepEqual(parseAnswer(fenced), obj);
  });
  it("parses fenced without language tag", () => {
    const obj = { summary: "ok", findings: [] };
    const fenced = "```\n" + JSON.stringify(obj) + "\n```";
    assert.deepEqual(parseAnswer(fenced), obj);
  });
  it("rejects text around the object", () => {
    const obj = { summary: "ok", findings: [] };
    assert.equal(parseAnswer("hello " + JSON.stringify(obj) + " bye"), null);
  });
  it("rejects invalid JSON", () => {
    assert.equal(parseAnswer("{ not json }"), null);
  });
  it("rejects missing summary", () => {
    assert.equal(parseAnswer(JSON.stringify({ findings: [] })), null);
  });
  it("rejects empty summary", () => {
    assert.equal(parseAnswer(JSON.stringify({ summary: "", findings: [] })), null);
  });
  it("rejects unknown severity", () => {
    assert.equal(parseAnswer(JSON.stringify({ summary: "s", findings: [{ severity: "critical", text: "x" }] })), null);
  });
  it("rejects finding with extra key", () => {
    assert.equal(parseAnswer(JSON.stringify({ summary: "s", findings: [{ severity: "low", text: "x", extra: 1 }] })), null);
  });
  it("rejects extra top-level key", () => {
    assert.equal(parseAnswer(JSON.stringify({ summary: "s", findings: [], extra: 1 })), null);
  });
  it("rejects missing findings", () => {
    assert.equal(parseAnswer(JSON.stringify({ summary: "s" })), null);
  });
  it("rejects empty text in finding", () => {
    assert.equal(parseAnswer(JSON.stringify({ summary: "s", findings: [{ severity: "low", text: "" }] })), null);
  });
});

describe("decideEvent", () => {
  it("returns COMMENT for null", () => {
    assert.equal(decideEvent(null), "COMMENT");
  });
  it("returns APPROVE for no findings", () => {
    assert.equal(decideEvent({ summary: "s", findings: [] }), "APPROVE");
  });
  it("returns APPROVE for medium finding", () => {
    assert.equal(decideEvent({ summary: "s", findings: [{ severity: "medium", text: "m" }] }), "APPROVE");
  });
  it("returns REQUEST_CHANGES for high finding", () => {
    assert.equal(decideEvent({ summary: "s", findings: [{ severity: "high", text: "h" }] }), "REQUEST_CHANGES");
  });
  it("verdict word inside model text cannot change decideEvent", () => {
    const answer = { summary: "APPROVE", findings: [{ severity: "high", text: "bad" }] };
    assert.equal(decideEvent(answer), "REQUEST_CHANGES");
  });
  it("mixed medium and high gives REQUEST_CHANGES", () => {
    assert.equal(decideEvent({ summary: "s", findings: [{ severity: "medium", text: "m" }, { severity: "high", text: "h" }] }), "REQUEST_CHANGES");
  });
  it("low only gives APPROVE", () => {
    assert.equal(decideEvent({ summary: "s", findings: [{ severity: "low", text: "l" }] }), "APPROVE");
  });
});

describe("cleanText", () => {
  it("replaces newline with space", () => {
    assert.equal(cleanText("a\nb"), "a b");
  });
  it("truncates long string to 600", () => {
    const long = "a".repeat(700);
    const out = cleanText(long, 600);
    assert.equal(out.length, 600);
    assert.equal(out.endsWith("…"), true);
  });
  it("replaces @ with @ plus zero-width space", () => {
    assert.equal(cleanText("@name"), "@\u200Bname");
    assert.equal(cleanText("a @b @c").includes("@\u200B"), true);
  });
  it("replaces backtick with single quote", () => {
    assert.equal(cleanText("`code`"), "'code'");
  });
  it("exactly 600 stays 600", () => {
    assert.equal(cleanText("a".repeat(600), 600).length, 600);
  });
  it("400 chars truncated to 300 with ellipsis", () => {
    const long = "a".repeat(400);
    const out = cleanText(long);
    assert.equal(out.length, 300);
    assert.equal(out.endsWith("…"), true);
    assert.equal(MAX_TEXT_CHARS, 300);
  });
  it("300 chars unchanged", () => {
    const s = "a".repeat(300);
    const out = cleanText(s);
    assert.equal(out.length, 300);
    assert.equal(out, s);
  });
});

describe("buildReviewBody", () => {
  it("last line names the model", () => {
    const body = buildReviewBody({ summary: "ok", findings: [] }, "my-model");
    assert.equal(body.endsWith("Reviewed by DeepSeek 4.1 Flash (my-model)"), true);
  });
  it("null form says it is not an approval", () => {
    const body = buildReviewBody(null, "my-model");
    assert.match(body, /not an approval/i);
    assert.match(body, /could not read/i);
    assert.equal(body.endsWith("Reviewed by DeepSeek 4.1 Flash (my-model)"), true);
  });
  it("includes findings", () => {
    const body = buildReviewBody({ summary: "summary", findings: [{ severity: "high", text: "bad" }] }, "m");
    assert.match(body, /- high: bad/);
  });
  it("null body first line is the not-approval sentence", () => {
    const body = buildReviewBody(null, "m");
    const first = body.split("\n")[0];
    assert.equal(first, "The reviewer could not read the model's answer. This is not an approval.");
  });
  it("with 12 low findings shows 10 and more line", () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({ severity: "low", text: `item ${i}` }));
    const body = buildReviewBody({ summary: "s", findings }, "m");
    const lines = body.split("\n");
    const findingLines = lines.filter((l) => l.startsWith("- low:"));
    assert.equal(findingLines.length, 10);
    assert.equal(MAX_FINDINGS, 10);
    assert.ok(body.includes("2 more findings not shown."));
  });
  it("with 11 findings says one more finding", () => {
    const findings = Array.from({ length: 11 }, (_, i) => ({ severity: "low", text: `item ${i}` }));
    const body = buildReviewBody({ summary: "s", findings }, "m");
    assert.ok(body.includes("1 more finding not shown."));
  });
  it("orders high before low", () => {
    const findings = [{ severity: "low", text: "low one" }, { severity: "high", text: "high one" }];
    const body = buildReviewBody({ summary: "s", findings }, "m");
    const idxHigh = body.indexOf("- high: high one");
    const idxLow = body.indexOf("- low: low one");
    assert.ok(idxHigh !== -1 && idxLow !== -1);
    assert.ok(idxHigh < idxLow);
  });
  it("with 11 low and one high last, decideEvent still REQUEST_CHANGES and body shows high", () => {
    const findings = [...Array.from({ length: 11 }, (_, i) => ({ severity: "low", text: `low ${i}` })), { severity: "high", text: "high last" }];
    const answer = { summary: "s", findings };
    assert.equal(decideEvent(answer), "REQUEST_CHANGES");
    const body = buildReviewBody(answer, "m");
    assert.ok(body.includes("- high: high last"));
    assert.ok(body.includes("2 more findings not shown."));
  });
});

describe("splitSavedData", () => {
  it("removes a section under web/src/data/examples/, keeps the sections before and after it unchanged, and names the path", () => {
    const secA = "diff --git a/foo.txt b/foo.txt\n--- a/foo.txt\n+++ b/foo.txt\n+hello";
    const secSaved = "diff --git a/web/src/data/examples/one.json b/web/src/data/examples/one.json\n--- a/web/src/data/examples/one.json\n+++ b/web/src/data/examples/one.json\n+{}" ;
    const secC = "diff --git a/bar.txt b/bar.txt\n--- a/bar.txt\n+++ b/bar.txt\n+world";
    const diff = [secA, secSaved, secC].join("\n");
    const res = splitSavedData(diff);
    assert.deepEqual(res.skipped, ["web/src/data/examples/one.json"]);
    assert.equal(res.diff, [secA, secC].join("\n"));
  });
  it("keeps web/src/data/sample-result.json and web/src/data/examples/deep/x.json", () => {
    const sec1 = "diff --git a/web/src/data/sample-result.json b/web/src/data/sample-result.json\ncontent1";
    const sec2 = "diff --git a/web/src/data/examples/deep/x.json b/web/src/data/examples/deep/x.json\ncontent2";
    const diff = [sec1, sec2].join("\n");
    const res = splitSavedData(diff);
    assert.deepEqual(res.skipped, []);
    assert.equal(res.diff, diff);
  });
  it("returns an empty skipped for a diff with no such section, and an unchanged diff", () => {
    const diff = "diff --git a/a.txt b/a.txt\nhello\nworld";
    const res = splitSavedData(diff);
    assert.deepEqual(res.skipped, []);
    assert.equal(res.diff, diff);
  });
  it("a line inside a section text that holds the words diff --git but does not start with them does not start a new section", () => {
    const secA = "diff --git a/a.txt b/a.txt\n+hello";
    const secSaved = "diff --git a/web/src/data/examples/keep.json b/web/src/data/examples/keep.json\n+data";
    const diff = secA + "\n some text diff --git inside\n" + secSaved;
    const res = splitSavedData(diff);
    assert.deepEqual(res.skipped, ["web/src/data/examples/keep.json"]);
    assert.equal(res.skipped.length, 1);
    assert.ok(res.diff.includes("some text diff --git inside"));
    assert.ok(!res.diff.includes("web/src/data/examples/keep.json"));
  });
});

describe("buildReviewBody with skipped", () => {
  it("names the skipped paths above the last line, with an answer", () => {
    const answer = { summary: "ok", findings: [] };
    const body = buildReviewBody(answer, "m", ["web/src/data/examples/a.json", "web/src/data/examples/b.json"]);
    const lines = body.split("\n");
    assert.equal(lines[lines.length - 1], "Reviewed by DeepSeek 4.1 Flash (m)");
    assert.equal(lines[lines.length - 2], "Not reviewed, saved data: web/src/data/examples/a.json, web/src/data/examples/b.json");
  });
  it("names the skipped paths above the last line, with a null answer", () => {
    const body = buildReviewBody(null, "m", ["web/src/data/examples/a.json"]);
    const lines = body.split("\n");
    assert.equal(lines[lines.length - 1], "Reviewed by DeepSeek 4.1 Flash (m)");
    assert.equal(lines[lines.length - 2], "Not reviewed, saved data: web/src/data/examples/a.json");
    assert.match(body, /not an approval/i);
  });
  it("with no skipped paths, its output is the same as before", () => {
    const answer = { summary: "ok", findings: [{ severity: "low", text: "minor" }] };
    const a = buildReviewBody(answer, "m", []);
    const b = buildReviewBody(answer, "m");
    assert.equal(a, b);
    const nullA = buildReviewBody(null, "m", []);
    const nullB = buildReviewBody(null, "m");
    assert.equal(nullA, nullB);
  });
});

describe("isApprovedByPerson", () => {
  const withReviews = async (reply, run) => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return reply;
    };
    try {
      await run(calls);
    } finally {
      globalThis.fetch = original;
    }
  };
  const reviews = (list) => ({ ok: true, json: async () => list });
  const person = { type: "User" };
  const approval = (fields) => ({ state: "APPROVED", commit_id: "abc", user: person, author_association: "OWNER", ...fields });

  it("is true when a person approved this commit", async () => {
    await withReviews(reviews([approval({})]), async (calls) => {
      assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), true);
      assert.equal(calls[0], "https://api.github.com/repos/o/r/pulls/1/reviews?per_page=100");
    });
  });
  it("is false with no reviews, so the check fails", async () => {
    await withReviews(reviews([]), async () => {
      assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), false);
    });
  });
  it("is false for an approval of an older commit", async () => {
    await withReviews(reviews([approval({ commit_id: "old" })]), async () => {
      assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), false);
    });
  });
  it("is false when a stranger approves, because anyone can press Approve on a public repo", async () => {
    for (const author_association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", undefined]) {
      await withReviews(reviews([approval({ author_association })]), async () => {
        assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), false);
      });
    }
  });
  it("is true for a collaborator, and false for an org member", async () => {
    await withReviews(reviews([approval({ author_association: "COLLABORATOR" })]), async () => {
      assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), true);
    });
    await withReviews(reviews([approval({ author_association: "MEMBER" })]), async () => {
      assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), false);
    });
  });
  it("is false for a bot's approval, or a person's comment", async () => {
    await withReviews(reviews([approval({ user: { type: "Bot" } }), approval({ state: "COMMENTED" })]), async () => {
      assert.equal(await isApprovedByPerson("token", "o/r", "1", "abc"), false);
    });
  });
  it("throws when it can't read the reviews, so the check fails", async () => {
    await withReviews({ ok: false }, async () => {
      await assert.rejects(isApprovedByPerson("token", "o/r", "1", "abc"));
    });
  });
});

describe("holdForDecision", () => {
  const withReplies = async (replies, run) => {
    const originalFetch = globalThis.fetch;
    const originalExitCode = process.exitCode;
    const originalLog = console.log;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return replies[calls.length - 1];
    };
    console.log = () => {};
    process.exitCode = undefined;
    try {
      await run(calls);
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      process.exitCode = originalExitCode;
    }
  };
  const reply = (value) => ({ ok: true, json: async () => value });
  const ownerApproval = { state: "APPROVED", commit_id: "abc", user: { type: "User" }, author_association: "OWNER" };
  const lead = { login: LEAD_LOGIN, type: "Bot" };
  const comment = (user, body) => ({ user, body });

  it("fails the check when nobody approved and the lead didn't clear it", async () => {
    await withReplies([reply([]), reply([])], async (calls) => {
      await holdForDecision("token", "o/r", "1", "abc");
      assert.equal(process.exitCode, 1);
      assert.equal(calls[1], "https://api.github.com/repos/o/r/issues/1/comments?per_page=100");
    });
  });
  it("passes once a person approved this commit, without reading comments", async () => {
    await withReplies([reply([ownerApproval])], async (calls) => {
      await holdForDecision("token", "o/r", "1", "abc");
      assert.equal(process.exitCode, undefined);
      assert.equal(calls.length, 1);
    });
  });
  it("passes when the lead cleared this commit with a reason", async () => {
    await withReplies([reply([]), reply([comment(lead, `${clearLine("abc")} the data files are saved output`)])], async () => {
      await holdForDecision("token", "o/r", "1", "abc");
      assert.equal(process.exitCode, undefined);
    });
  });
  it("stays held when the lead gives no reason", async () => {
    await withReplies([reply([]), reply([comment(lead, `${clearLine("abc")}  `)])], async () => {
      await holdForDecision("token", "o/r", "1", "abc");
      assert.equal(process.exitCode, 1);
    });
  });
  it("stays held when someone else posts the line, or it names an older commit", async () => {
    const replies = [reply([]), reply([
      comment({ login: "stranger", type: "User" }, `${clearLine("abc")} trust me`),
      comment({ login: LEAD_LOGIN, type: "User" }, `${clearLine("abc")} trust me`),
      comment(lead, `${clearLine("old")} an older commit`)
    ])];
    await withReplies(replies, async () => {
      await holdForDecision("token", "o/r", "1", "abc");
      assert.equal(process.exitCode, 1);
    });
  });
  it("throws when it can't read the comments, so the check fails", async () => {
    await withReplies([reply([]), { ok: false, status: 403 }], async () => {
      await assert.rejects(holdForDecision("token", "o/r", "1", "abc"), /403/);
    });
  });
});

describe("clearLine", () => {
  it("names the exact commit", () => {
    assert.equal(clearLine("abc"), "Review hold cleared for abc:");
  });
});
