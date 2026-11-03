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
  PATCH_COMMANDS,
  MAX_GITHUB_LINK,
  rerunHref,
  savedCheckHref,
  repoFileHref,
  claudeFileFromStep,
  understoodSections,
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

describe("PATCH_COMMANDS", () => {
  test("holds git apply --index yokoten-doctor.patch", () => {
    assert.equal(PATCH_COMMANDS.includes("git apply --index yokoten-doctor.patch"), true);
  });
  test("does not hold git add -A", () => {
    assert.equal(PATCH_COMMANDS.includes("git add -A"), false);
  });
});

describe("savedCheckHref", () => {
  test('savedCheckHref("owner", "repo") equals "/?repo=owner/repo&saved=1"', () => {
    assert.equal(savedCheckHref("owner", "repo"), "/?repo=owner/repo&saved=1");
  });
});

describe("repoFileHref", () => {
  test('repoFileHref("o", "r", "main", "blob", "AGENTS.md") equals "https://github.com/o/r/blob/main/AGENTS.md"', () => {
    assert.equal(repoFileHref("o", "r", "main", "blob", "AGENTS.md"), "https://github.com/o/r/blob/main/AGENTS.md");
  });
  test("a null branch means main", () => {
    assert.equal(repoFileHref("o", "r", null, "blob", "AGENTS.md"), "https://github.com/o/r/blob/main/AGENTS.md");
  });
  test('repoFileHref("o", "r", "a/b", "edit", ".claude/CLAUDE.md") equals "https://github.com/o/r/edit/a/b/.claude/CLAUDE.md"', () => {
    assert.equal(repoFileHref("o", "r", "a/b", "edit", ".claude/CLAUDE.md"), "https://github.com/o/r/edit/a/b/.claude/CLAUDE.md");
  });
});

describe("claudeFileFromStep", () => {
  test('text holding ".claude/CLAUDE.md" gives { file: ".claude/CLAUDE.md", line: "@../AGENTS.md" }', () => {
    assert.deepEqual(claudeFileFromStep("please update .claude/CLAUDE.md"), { file: ".claude/CLAUDE.md", line: "@../AGENTS.md" });
  });
  test('text holding only "CLAUDE.md" gives { file: "CLAUDE.md", line: "@AGENTS.md" }', () => {
    assert.deepEqual(claudeFileFromStep("please update CLAUDE.md"), { file: "CLAUDE.md", line: "@AGENTS.md" });
  });
  test("undefined gives the same", () => {
    assert.deepEqual(claudeFileFromStep(undefined), { file: "CLAUDE.md", line: "@AGENTS.md" });
  });
});

describe("understoodSections", () => {
  test("the headings ### Build, ### Test, ### What not to touch give three sections in the order How to build it, How to test it, What not to touch", () => {
    const content = "## This project\n### Build\nbuild line\n### Test\ntest line\n### What not to touch\ntouch line\n";
    assert.deepEqual(understoodSections(content), [
      { title: "How to build it", lines: ["build line"] },
      { title: "How to test it", lines: ["test line"] },
      { title: "What not to touch", lines: ["touch line"] },
    ]);
  });
  test("### Do not touch also gives What not to touch", () => {
    const content = "## This project\n### Build\nb\n### Test\nt\n### Do not touch\nd\n";
    const sections = understoodSections(content);
    assert.equal(sections[2].title, "What not to touch");
    assert.deepEqual(sections[2].lines, ["d"]);
  });
  test("a leading - is removed from a line", () => {
    const content = "## This project\n### Build\n- build line\n### Test\nt\n### What not to touch\nx\n";
    assert.deepEqual(understoodSections(content)[0].lines, ["build line"]);
  });
  test("blank lines are dropped", () => {
    const content = "## This project\n### Build\n\nb1\n\nb2\n\n### Test\nt\n### What not to touch\nx\n";
    assert.deepEqual(understoodSections(content)[0].lines, ["b1", "b2"]);
  });
  test("another heading is ignored", () => {
    const content = "## This project\n### Build\nb\n### Test\nt\n### What not to touch\nx\n### Other\nignore\n";
    const sections = understoodSections(content);
    assert.equal(sections.length, 3);
  });
  test("a missing section returns null", () => {
    const content = "## This project\n### Build\nb\n### Test\nt\n";
    assert.equal(understoodSections(content), null);
  });
  test("a section with no lines returns null", () => {
    const content = "## This project\n### Build\n### Test\nt\n### What not to touch\nx\n";
    assert.equal(understoodSections(content), null);
  });
  test("content with no ## This project returns null", () => {
    assert.equal(understoodSections("## Other\n### Build\nb\n"), null);
  });
  test("### Do not touch tests gives What not to touch and not How to test it when Build and Test are also there", () => {
    const content = "## This project\n### Build\nb\n### Test\nt\n### Do not touch tests\nd\n";
    const sections = understoodSections(content);
    assert.equal(sections[2].title, "What not to touch");
    assert.deepEqual(sections[2].lines, ["d"]);
  });
  test("when two headings match one section the first one's lines are kept", () => {
    const content = "## This project\n### Build\nb\n### Test\na\n### More tests\nb\n### What not to touch\nx\n";
    const sections = understoodSections(content);
    assert.equal(sections[1].title, "How to test it");
    assert.deepEqual(sections[1].lines, ["a"]);
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
