import assert from "node:assert/strict";
import { test, describe } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  isSafePath,
  newFileLink,
  fileLinkPlan,
  buildPatch,
  orderFiles,
  fixMessage,
  PATCH_COMMANDS,
  MAX_GITHUB_LINK,
  isFilesSectionHidden,
  rerunHref,
} from "../../web/src/client/fixes.ts";

describe("isSafePath", () => {
  test("true for AGENTS.md", () => {
    assert.equal(isSafePath("AGENTS.md"), true);
  });
  test("true for .github/ISSUE_TEMPLATE/task.yml", () => {
    assert.equal(isSafePath(".github/ISSUE_TEMPLATE/task.yml"), true);
  });
  test("false for empty string", () => {
    assert.equal(isSafePath(""), false);
  });
  test("false for ../x", () => {
    assert.equal(isSafePath("../x"), false);
  });
  test("false for a/../b", () => {
    assert.equal(isSafePath("a/../b"), false);
  });
  test("false for /etc/passwd", () => {
    assert.equal(isSafePath("/etc/passwd"), false);
  });
  test("false for a//b", () => {
    assert.equal(isSafePath("a//b"), false);
  });
  test("false for ./a", () => {
    assert.equal(isSafePath("./a"), false);
  });
  test("false for a\\b", () => {
    assert.equal(isSafePath("a\\b"), false);
  });
  test("false for path with newline", () => {
    assert.equal(isSafePath("a\n b"), false);
    assert.equal(isSafePath("a\nb"), false);
  });
});

describe("newFileLink", () => {
  test("null branch means main", () => {
    const link = newFileLink("owner", "repo", null, "a.txt", "hello");
    assert.match(link, /\/new\/main\?/);
    const url = new URL(link);
    assert.equal(url.pathname.includes("/new/main"), true);
  });
  test("branch with slash keeps its /", () => {
    const link = newFileLink("owner", "repo", "feature/foo", "a.txt", "hello");
    assert.equal(link.includes("/new/feature/foo?"), true);
    assert.equal(link.includes("%2F"), false);
    const url = new URL(link);
    assert.equal(url.pathname, "/owner/repo/new/feature/foo");
  });
  test("filename and value decode back through searchParams for path with folder", () => {
    const p = "some/folder/file.txt";
    const c = "hello world";
    const link = newFileLink("owner", "repo", "main", p, c);
    const url = new URL(link);
    assert.equal(url.searchParams.get("filename"), p);
    assert.equal(url.searchParams.get("value"), c);
  });
  test("filename and value decode back for content with special chars", () => {
    const p = "a/b.txt";
    const c = "a & b # c + d % e\nnewline \u3053\u3093\u306b\u3061\u306f non-ascii \u2603";
    const link = newFileLink("owner", "repo", null, p, c);
    const url = new URL(link);
    assert.equal(url.searchParams.get("filename"), p);
    assert.equal(url.searchParams.get("value"), c);
  });
  test("content with &, #, +, %, newline and non-ASCII", () => {
    const content = "& # + % \n \u00e9 \u4e2d";
    const link = newFileLink("o", "r", "main", "f.txt", content);
    const url = new URL(link);
    assert.equal(url.searchParams.get("value"), content);
  });
  test("null content gives no value", () => {
    const link = newFileLink("owner", "repo", null, "a.txt", null);
    const url = new URL(link);
    assert.equal(url.searchParams.has("value"), false);
    assert.equal(url.searchParams.get("filename"), "a.txt");
  });
});

describe("fileLinkPlan", () => {
  test("a short file is filled", () => {
    const file = { path: "a.txt", content: "hi" };
    const plan = fileLinkPlan("owner", "repo", null, file);
    assert.equal(plan.kind, "filled");
    assert.equal(plan.href, newFileLink("owner", "repo", null, file.path, file.content));
  });
  test("a long file is copy first, with no value", () => {
    const longContent = "x".repeat(MAX_GITHUB_LINK + 1000);
    const file = { path: "a.txt", content: longContent };
    const plan = fileLinkPlan("owner", "repo", null, file);
    assert.equal(plan.kind, "copy first");
    const url = new URL(plan.href);
    assert.equal(url.searchParams.has("value"), false);
    assert.equal(plan.href, newFileLink("owner", "repo", null, file.path, null));
  });
  test("a file whose link is exactly MAX_GITHUB_LINK characters is filled", () => {
    const owner = "owner";
    const repo = "repo";
    const branch = null;
    const filePath = "a.txt";
    const baseNoValue = newFileLink(owner, repo, branch, filePath, null);
    const overhead = "&value=".length;
    const targetContentLen = MAX_GITHUB_LINK - baseNoValue.length - overhead;
    assert.ok(targetContentLen > 0, "targetContentLen should be positive");
    const content = "a".repeat(targetContentLen);
    const filled = newFileLink(owner, repo, branch, filePath, content);
    assert.equal(filled.length, MAX_GITHUB_LINK);
    const plan = fileLinkPlan(owner, repo, branch, { path: filePath, content });
    assert.equal(plan.kind, "filled");
    assert.equal(plan.href.length, MAX_GITHUB_LINK);
  });
  test("one character more is copy first", () => {
    const owner = "owner";
    const repo = "repo";
    const branch = null;
    const filePath = "a.txt";
    const baseNoValue = newFileLink(owner, repo, branch, filePath, null);
    const overhead = "&value=".length;
    const targetContentLen = MAX_GITHUB_LINK - baseNoValue.length - overhead;
    const content = "a".repeat(targetContentLen + 1);
    const filled = newFileLink(owner, repo, branch, filePath, content);
    assert.equal(filled.length, MAX_GITHUB_LINK + 1);
    const plan = fileLinkPlan(owner, repo, branch, { path: filePath, content });
    assert.equal(plan.kind, "copy first");
    const url = new URL(plan.href);
    assert.equal(url.searchParams.has("value"), false);
  });
});

describe("buildPatch", () => {
  function withGitRepo(patchFiles, callback) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yokoten-patch-"));
    try {
      execFileSync("git", ["init"], { cwd: tmp });
      const patch = buildPatch(patchFiles);
      const patchPath = path.join(tmp, "yokoten-doctor.patch");
      if (patch !== "") {
        fs.writeFileSync(patchPath, patch, "utf8");
        execFileSync("git", ["apply", "--check", "yokoten-doctor.patch"], { cwd: tmp });
        execFileSync("git", ["apply", "yokoten-doctor.patch"], { cwd: tmp });
      }
      callback(tmp, patch);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  test("file in a new folder", () => {
    const files = [{ path: "foo/bar/baz.md", content: "hello\n" }];
    withGitRepo(files, (tmp) => {
      const got = fs.readFileSync(path.join(tmp, "foo/bar/baz.md"), "utf8");
      assert.equal(got, "hello\n");
    });
  });

  test("file that ends in a newline", () => {
    const files = [{ path: "a.txt", content: "line1\nline2\n" }];
    withGitRepo(files, (tmp) => {
      const got = fs.readFileSync(path.join(tmp, "a.txt"), "utf8");
      assert.equal(got, "line1\nline2\n");
    });
  });

  test("file that does not end in a newline", () => {
    const files = [{ path: "b.txt", content: "line1\nline2" }];
    withGitRepo(files, (tmp) => {
      const got = fs.readFileSync(path.join(tmp, "b.txt"), "utf8");
      assert.equal(got, "line1\nline2");
    });
  });

  test("empty content", () => {
    const files = [{ path: "empty.txt", content: "" }];
    withGitRepo(files, (tmp, patch) => {
      assert.match(patch, /new file mode 100644/);
      const got = fs.readFileSync(path.join(tmp, "empty.txt"), "utf8");
      assert.equal(got, "");
    });
  });

  test("line starting with -, + or a space", () => {
    const content = "- dash\n+ plus\n space\n";
    const files = [{ path: "special.txt", content }];
    withGitRepo(files, (tmp) => {
      const got = fs.readFileSync(path.join(tmp, "special.txt"), "utf8");
      assert.equal(got, content);
    });
  });

  test("\\r\\n line ends", () => {
    const content = "a\r\nb\r\n";
    const files = [{ path: "crlf.txt", content }];
    withGitRepo(files, (tmp) => {
      const got = fs.readFileSync(path.join(tmp, "crlf.txt"), "utf8");
      assert.equal(got, content);
    });
  });

  test("non-ASCII text", () => {
    const content = "\u3053\u3093\u306b\u3061\u306f\n\u2603\ncaf\u00e9\n";
    const files = [{ path: "unicode.txt", content }];
    withGitRepo(files, (tmp) => {
      const got = fs.readFileSync(path.join(tmp, "unicode.txt"), "utf8");
      assert.equal(got, content);
    });
  });

  test("several files in one patch", () => {
    const files = [
      { path: "one.txt", content: "one\n" },
      { path: "two.txt", content: "two" },
      { path: "dir/three.txt", content: "three\n" },
    ];
    withGitRepo(files, (tmp) => {
      for (const f of files) {
        const got = fs.readFileSync(path.join(tmp, f.path), "utf8");
        assert.equal(got, f.content);
      }
    });
  });

  test("an unsafe path is left out", () => {
    const files = [
      { path: "../x", content: "bad" },
      { path: "good.txt", content: "good\n" },
    ];
    const patch = buildPatch(files);
    assert.equal(patch.includes("../x"), false);
    assert.equal(patch.includes("good.txt"), true);
    withGitRepo(files, (tmp) => {
      assert.equal(fs.existsSync(path.join(tmp, "good.txt")), true);
      assert.equal(fs.existsSync(path.join(tmp, "../x")), false);
      assert.equal(fs.existsSync(path.join(tmp, "x")), false);
      const got = fs.readFileSync(path.join(tmp, "good.txt"), "utf8");
      assert.equal(got, "good\n");
    });
  });

  test("no file left gives an empty string", () => {
    assert.equal(buildPatch([]), "");
    assert.equal(buildPatch([{ path: "../bad", content: "x" }]), "");
    assert.equal(buildPatch([{ path: "", content: "x" }]), "");
  });
});

describe("orderFiles", () => {
  test("AGENTS.md goes first from any place", () => {
    const files = [
      { path: "foo.txt", content: "a" },
      { path: "AGENTS.md", content: "b" },
      { path: "bar.txt", content: "c" },
    ];
    const { first, rest } = orderFiles(files);
    assert.equal(first.path, "AGENTS.md");
    assert.deepEqual(
      rest.map((f) => f.path),
      ["foo.txt", "bar.txt"],
    );
  });

  test("AGENTS.md first even when at end", () => {
    const files = [
      { path: "a.txt", content: "1" },
      { path: "b.txt", content: "2" },
      { path: "AGENTS.md", content: "3" },
    ];
    const { first } = orderFiles(files);
    assert.equal(first.path, "AGENTS.md");
  });

  test("the others keep their order", () => {
    const files = [
      { path: "AGENTS.md", content: "x" },
      { path: "b.txt", content: "2" },
      { path: "c.txt", content: "3" },
      { path: "a.txt", content: "1" },
    ];
    const { first, rest } = orderFiles(files);
    assert.equal(first.path, "AGENTS.md");
    assert.deepEqual(rest.map((f) => f.path), ["b.txt", "c.txt", "a.txt"]);
  });

  test("no AGENTS.md takes the first file", () => {
    const files = [
      { path: "b.txt", content: "2" },
      { path: "a.txt", content: "1" },
    ];
    const { first, rest } = orderFiles(files);
    assert.equal(first.path, "b.txt");
    assert.deepEqual(rest.map((f) => f.path), ["a.txt"]);
  });

  test("an unsafe path is left out", () => {
    const files = [
      { path: "../bad", content: "x" },
      { path: "AGENTS.md", content: "ok" },
      { path: "good.txt", content: "y" },
    ];
    const { first, rest } = orderFiles(files);
    assert.equal(first.path, "AGENTS.md");
    assert.deepEqual(rest.map((f) => f.path), ["good.txt"]);
    assert.equal(
      rest.some((f) => f.path === "../bad"),
      false,
    );
  });

  test("empty list gives null and empty list", () => {
    const { first, rest } = orderFiles([]);
    assert.equal(first, null);
    assert.deepEqual(rest, []);
  });

  test("empty list after filtering unsafe gives null", () => {
    const { first, rest } = orderFiles([{ path: "../x", content: "h" }]);
    assert.equal(first, null);
    assert.deepEqual(rest, []);
  });
});

describe("fixMessage", () => {
  test('"failed" gives the Muse message, even with files', () => {
    const msg = fixMessage({ files: [{ path: "a.txt" }], muse: "failed" });
    assert.equal(
      msg,
      "Muse couldn't write the “This project” section this time. Fill it in yourself.",
    );
  });
  test('"failed" with no files also gives Muse message', () => {
    const msg = fixMessage({ files: [], muse: "failed" });
    assert.equal(
      msg,
      "Muse couldn't write the “This project” section this time. Fill it in yourself.",
    );
  });
  test("no files gives the no-files message", () => {
    const msg = fixMessage({ files: [], muse: "ok" });
    assert.equal(msg, "yokoten has nothing to add to this repo.");
  });
  test("no files with not needed also gives no-files message", () => {
    const msg = fixMessage({ files: [], muse: "not needed" });
    assert.equal(msg, "yokoten has nothing to add to this repo.");
  });
  test('files with "ok" give empty string', () => {
    const msg = fixMessage({ files: [{ path: "AGENTS.md" }], muse: "ok" });
    assert.equal(msg, "");
  });
  test('files with "not needed" give empty string', () => {
    const msg = fixMessage({ files: [{ path: "AGENTS.md" }], muse: "not needed" });
    assert.equal(msg, "");
  });
});

describe("PATCH_COMMANDS", () => {
  test("holds git apply --index yokoten-doctor.patch", () => {
    assert.equal(PATCH_COMMANDS.includes("git apply --index yokoten-doctor.patch"), true);
  });
  test("does not hold git add -A", () => {
    assert.equal(PATCH_COMMANDS.includes("git add -A"), false);
  });
});

describe("isFilesSectionHidden", () => {
  test("true for {files: [], muse: \"ok\"} with install-only open", () => {
    assert.equal(isFilesSectionHidden({ files: [], muse: "ok" }, true), true);
  });
  test("true for {files: [], muse: \"not needed\"} with install-only open", () => {
    assert.equal(isFilesSectionHidden({ files: [], muse: "not needed" }, true), true);
  });
  test("false for muse: \"lost\" with install-only open", () => {
    assert.equal(isFilesSectionHidden({ files: [], muse: "lost" }, true), false);
  });
  test("false for muse: \"failed\" with install-only open", () => {
    assert.equal(isFilesSectionHidden({ files: [], muse: "failed" }, true), false);
  });
  test("false for {files: [{path: \"AGENTS.md\"}], muse: \"ok\"} with install-only open", () => {
    assert.equal(isFilesSectionHidden({ files: [{ path: "AGENTS.md" }], muse: "ok" }, true), false);
  });
  test("false for {files: [], muse: \"ok\"} with none open", () => {
    assert.equal(isFilesSectionHidden({ files: [], muse: "ok" }, false), false);
  });
  test("false for null", () => {
    assert.equal(isFilesSectionHidden(null, true), false);
  });
});

describe("rerunHref", () => {
  test('rerunHref("owner", "repo") equals "/?repo=owner/repo"', () => {
    assert.equal(rerunHref("owner", "repo"), "/?repo=owner/repo");
  });
  test('rerunHref("a b", "c&d") equals "/?repo=a%20b/c%26d"', () => {
    assert.equal(rerunHref("a b", "c&d"), "/?repo=a%20b/c%26d");
  });
});
