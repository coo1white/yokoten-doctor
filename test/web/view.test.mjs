import assert from "node:assert/strict";
import { test } from "node:test";
import { viewModel, markLabel, splitCode, formatRecordTime, repoFromInput, repoFromQuery, secretFolders, toSentence } from "../../web/src/client/view.ts";
import { projectSection } from "../../web/src/client/fixes.ts";

test("viewModel: evidence has the short commit", () => {
  const result = {
    owner: "owner",
    repo: "repo",
    commit: "abcdef1234567890",
    yokoten_version: "1.2.3",
    about: "about",
    rerun: { doctor: "npx yokoten doctor", check: "npx yokoten check" },
    summary: {
      done: 3,
      total: 10,
      next: {
        id: "next-id",
        title: "Next Title",
        what: "what next",
        why: "why next",
        fix: "fix next",
        how: "how next",
        docs: "https://example.com/docs",
      },
      steps: [
        { id: "next-id", title: "Next Title", mark: "to do", how: "h" },
        { id: "other-1", title: "Other One", mark: "done", how: "h2" },
        { id: "install-1", title: "Install One", mark: "done", how: "h3" },
      ],
      install_only: [
        { id: "install-1", title: "Install One", mark: "done", how: "h3" },
      ],
    },
    secrets: [],
  };

  const vm = viewModel(result);
  assert.equal(vm.evidence.shortCommit, "abcdef1");
  assert.equal(vm.evidence.commit, "abcdef1234567890");
  assert.equal(vm.evidence.version, "1.2.3");
});

test("markLabel for each mark, including unknown and not now with reason", () => {
  assert.equal(markLabel("done"), "done");
  assert.equal(markLabel("to do"), "to do");
  assert.equal(markLabel("next"), "to do");
  assert.equal(markLabel("not now"), "skipped on purpose");
  assert.equal(markLabel("not now", "we decided"), "skipped on purpose: we decided");
  assert.equal(markLabel("can't check"), "can't tell from here");
  assert.equal(markLabel("something-unknown"), "unknown");
});

test("viewModel: secrets grouped by id in first-seen order", () => {
  const result = {
    summary: { done: 0, total: 0, steps: [], install_only: [] },
    secrets: [
      { id: "a", what: "what a", why: "why a", fix: "fix a", file: "file1.txt", line: 10 },
      { id: "b", what: "what b", why: "why b", fix: "fix b", file: "file2.txt", line: 5 },
      { id: "a", what: "what a second", why: "why a second", fix: "fix a second", file: "file3.txt", line: 20 },
    ],
  };
  const vm = viewModel(result);
  assert.equal(vm.secretCount, 3);
  assert.equal(vm.secretGroups.length, 2);
  assert.equal(vm.secretGroups[0].what, "what a");
  assert.equal(vm.secretGroups[0].why, "why a");
  assert.equal(vm.secretGroups[0].fix, "fix a");
  assert.deepEqual(vm.secretGroups[0].places, ["file1.txt:10", "file3.txt:20"]);
  assert.equal(vm.secretGroups[1].what, "what b");
  assert.deepEqual(vm.secretGroups[1].places, ["file2.txt:5"]);
});

test("viewModel: places with and without line", () => {
  const result = {
    summary: { done: 0, total: 0, steps: [], install_only: [] },
    secrets: [
      { id: "x", what: "w", why: "y", fix: "f", file: "a.txt", line: 1 },
      { id: "x", what: "w", why: "y", fix: "f", file: "b.txt" },
      { id: "x", what: "w", why: "y", fix: "f", file: "c.txt", line: null },
    ],
  };
  const vm = viewModel(result);
  assert.equal(vm.secretCount, 3);
  assert.equal(vm.secretGroups.length, 1);
  assert.deepEqual(vm.secretGroups[0].places, ["a.txt:1", "b.txt", "c.txt"]);
});

test("viewModel: secretCount total and empty case", () => {
  const emptyResult = {
    summary: { done: 0, total: 0, steps: [], install_only: [] },
    secrets: [],
  };
  const vmEmpty = viewModel(emptyResult);
  assert.equal(vmEmpty.secretCount, 0);
  assert.deepEqual(vmEmpty.secretGroups, []);

  const oneResult = {
    summary: { done: 0, total: 0, steps: [], install_only: [] },
    secrets: [{ id: "only", what: "w", why: "y", fix: "f", file: "f.txt", line: 2 }],
  };
  const vmOne = viewModel(oneResult);
  assert.equal(vmOne.secretCount, 1);
  assert.equal(vmOne.secretGroups.length, 1);
  assert.deepEqual(vmOne.secretGroups[0].places, ["f.txt:2"]);
});

test("viewModel: grouping preserves first-seen order with many ids", () => {
  const result = {
    summary: { done: 0, total: 0, steps: [], install_only: [] },
    secrets: [
      { id: "b", what: "wb", why: "yb", fix: "fb", file: "b.txt", line: 1 },
      { id: "a", what: "wa", why: "ya", fix: "fa", file: "a.txt", line: 1 },
      { id: "b", what: "wb2", why: "yb2", fix: "fb2", file: "b2.txt", line: 2 },
      { id: "c", what: "wc", why: "yc", fix: "fc", file: "c.txt" },
    ],
  };
  const vm = viewModel(result);
  assert.equal(vm.secretCount, 4);
  assert.equal(vm.secretGroups.length, 3);
  assert.equal(vm.secretGroups[0].what, "wb");
  assert.deepEqual(vm.secretGroups[0].places, ["b.txt:1", "b2.txt:2"]);
  assert.equal(vm.secretGroups[1].what, "wa");
  assert.equal(vm.secretGroups[2].what, "wc");
  assert.deepEqual(vm.secretGroups[2].places, ["c.txt"]);
});

test("splitCode: plain text", () => {
  assert.deepEqual(splitCode("hello world"), [{ text: "hello world", isCode: false }]);
});

test("splitCode: one code part", () => {
  assert.deepEqual(splitCode("a `code` b"), [
    { text: "a ", isCode: false },
    { text: "code", isCode: true },
    { text: " b", isCode: false },
  ]);
});

test("splitCode: two code parts", () => {
  assert.deepEqual(splitCode("`one` and `two`"), [
    { text: "one", isCode: true },
    { text: " and ", isCode: false },
    { text: "two", isCode: true },
  ]);
});

test("splitCode: an unmatched backtick stays as text", () => {
  assert.deepEqual(splitCode("a `unclosed"), [{ text: "a `unclosed", isCode: false }]);
  assert.deepEqual(splitCode("text `code"), [{ text: "text `code", isCode: false }]);
});

test("splitCode: an empty string", () => {
  assert.deepEqual(splitCode(""), []);
});

test("formatRecordTime: 2026-10-31T05:45:28Z gives 2026-10-31 05:45 UTC", () => {
  assert.equal(formatRecordTime("2026-10-31T05:45:28Z"), "2026-10-31 05:45 UTC");
});

test("formatRecordTime: text it cannot read comes back unchanged", () => {
  assert.equal(formatRecordTime("not-a-date"), "not-a-date");
  assert.equal(formatRecordTime("hello"), "hello");
});

test("repoFromInput: valid cases", () => {
  assert.equal(repoFromInput("owner/repo"), "owner/repo");
  assert.equal(repoFromInput("https://github.com/owner/repo"), "owner/repo");
  assert.equal(repoFromInput("https://github.com/owner/repo.git"), "owner/repo");
  assert.equal(repoFromInput("owner/repo/"), "owner/repo");
  assert.equal(repoFromInput("https://github.com/owner/repo/"), "owner/repo");
  assert.equal(repoFromInput("  owner/repo  "), "owner/repo");
  assert.equal(repoFromInput("  https://github.com/owner/repo  "), "owner/repo");
  assert.equal(repoFromInput("https://github.com/owner/repo.git/"), "owner/repo");
});

test("repoFromInput: null for invalid cases", () => {
  assert.equal(repoFromInput("../etc/passwd"), null);
  assert.equal(repoFromInput("owner"), null);
  assert.equal(repoFromInput("a/b/c"), null);
  assert.equal(repoFromInput("https://evil.example/owner/repo"), null);
  assert.equal(repoFromInput("owner/.."), null);
  assert.equal(repoFromInput("<script>/x"), null);
  assert.equal(repoFromInput(""), null);
  assert.equal(repoFromInput("   "), null);
});

test("repoFromQuery: valid cases", () => {
  assert.equal(repoFromQuery("?repo=owner%2Frepo"), "owner/repo");
  assert.equal(repoFromQuery("?repo=owner/repo"), "owner/repo");
  assert.equal(repoFromQuery("repo=owner%2Frepo"), "owner/repo");
});

test("repoFromQuery: null for invalid cases", () => {
  assert.equal(repoFromQuery("?foo=bar"), null);
  assert.equal(repoFromQuery("?repo="), null);
  assert.equal(repoFromQuery("?repo=../x"), null);
  assert.equal(repoFromQuery("?repo=owner/repo/more"), null);
  assert.equal(repoFromQuery(""), null);
  assert.equal(repoFromQuery("?repo=../x"), null);
});

test("secretFolders: groups by folder", () => {
  const places = ["docs/whitepaper/latex/main.tex:60", "docs/whitepaper/latex/other.tex:10", "test/js-scripts/dist/bundle.js:1"];
  assert.deepEqual(secretFolders(places), [
    { folder: "docs/whitepaper/latex/", count: 2 },
    { folder: "test/js-scripts/dist/", count: 1 },
  ]);
});

test("secretFolders: place with no slash gives ./", () => {
  assert.deepEqual(secretFolders(["README.md:5"]), [{ folder: "./", count: 1 }]);
});

test("secretFolders: repeat folder counts", () => {
  const places = ["a/b/c.txt:1", "a/b/d.txt:2", "a/b/c.txt:3", "./"];
  assert.deepEqual(secretFolders(places), [
    { folder: "a/b/", count: 3 },
    { folder: "./", count: 1 },
  ]);
});

test("projectSection: extracts from heading to end", () => {
  const content = "# Title\n\nSome intro\n\n## This project\n\n### Build\nDo build\n";
  assert.equal(projectSection(content), "## This project\n\n### Build\nDo build");
});

test("projectSection: returns empty when heading missing", () => {
  assert.equal(projectSection("# Nope"), "");
});

test("projectSection: trims whitespace", () => {
  const content = "## This project\nhello\n\n";
  assert.equal(projectSection(content), "## This project\nhello");
});

test("toSentence: upper-cases first letter and adds full stop", () => {
  assert.equal(toSentence("an agent follows the rules it can read, and only those"), "An agent follows the rules it can read, and only those.");
});

test("toSentence: keeps existing full stop", () => {
  assert.equal(toSentence("Already done."), "Already done.");
});

test("toSentence: keeps ! and ?", () => {
  assert.equal(toSentence("is it done?"), "Is it done?");
  assert.equal(toSentence("wow!"), "Wow!");
});

test("toSentence: empty returns empty", () => {
  assert.equal(toSentence(""), "");
});

test("toSentence: single word", () => {
  assert.equal(toSentence("hello"), "Hello.");
});
