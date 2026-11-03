# yokoten doctor (web): design

Status: draft 3, 2026-10-28; owner decisions of 2026-10-29 added. Written by Claude (design and review only).
Every line of code in this repo is written by Muse, from this document.

Changes from draft 2: the server runs the real yokoten instead of the page
re-implementing its checks; one repo holds web and server; each result can be
re-run by anyone; an optional public record of each check.

## 1. What it is

A web page for people who have never used a terminal tool like yokoten.

1. They paste a public GitHub repo URL.
2. Behind the page, the latest yokoten release checks that repo, exactly as
   `yokoten doctor` would.
3. Muse writes the missing files for *this* repo (not a template), and the page
   hands them over as a patch to download or files to copy.
4. The page ends with one line: for the full check on your own machine, run
   `npx yokoten`.

It is a front door to yokoten, not a new product. The yokoten CLI stays the
product; this page brings people to it.

Shape borrowed from ora.ai and is-agentic.com (paste a URL, get evidence and
ranked fixes). Different in three ways: it reads a code repo, not a website; it
gives the fix itself, not only advice; and nothing is hidden. yokoten is MIT,
and so is this page. Every check shows the rule it used, the page shows exactly
what was sent to Muse, the fixes need no sign-up or waitlist, and anyone can
re-run a result or run their own copy.

### The name

Same name as the `yokoten doctor` command on purpose: the judging is the same
thing, so what the page shows is what the terminal would show. The page adds
the sandbox run and the Muse-written fixes. Three rules keep the shared name
from confusing anyone:

- Where to report: a wrong check result goes to the yokoten repo; a broken
  page goes to this repo. The README and the page footer link both.
- No npm package from this repo. The one way to install is `npx yokoten`.
- One way to say it: "doctor.yokoten.app" or "yokoten doctor (web)"; the repo
  description is "The web version of `yokoten doctor`". Never a new product
  name.

## 2. Goals and non-goals

Goals, in order:

1. One paste to a useful result in under 60 seconds.
2. The result is something you can use: real files written for your repo.
3. The web result is the CLI result: the page shows what yokoten itself said.
4. Nobody has to trust our server: a result can be re-run by anyone (section 6.4).
5. Small enough for one person to finish and demo by the deadline.

Not in v1 (said out loud so nobody builds it):

- No GitHub write access. The page never opens a pull request, never pushes,
  stores no GitHub token from the user.
- No private repos. No sign-in.
- No score dial or chart as the main thing. A dashboard as the main feature is
  banned by the hackathon rules; the main thing is the generated fix.
- No chat box. (An ask box with fixed answers is an optional last step,
  section 9; it is never the main feature.)
- No checks of our own. Every mark comes from yokoten.

## 3. Rules from the hackathon that shape the design

- Fresh public repo; only work done after the kickoff counts.
- yokoten is a pre-existing tool, disclosed as one. It is an npm dependency of
  the server, like Node.js; no yokoten code is copied into this repo. What is
  new and scored: the page, the sandbox service that runs yokoten, the Muse
  part, and the re-run proof.
- Meta model use is 25% of the score, so Muse does real work at run time: it
  reads the repo and writes the files. The checks are yokoten's plain code
  (fast, the same every time); Muse is used where judgment and writing are
  needed.
- Open Weights bonus: the run-time model is Muse Spark Open, served by Baseten.
- Deadline 2026-11-05 02:00 UTC. Video 3 minutes.

## 4. User flow (one page, three states)

**State A, empty.** The first screen is one headline, one input with the cursor
already in it, and one button: Check. Under it are real saved results, what the
page reads and sends, and the same check for a terminal.

**State B, working.** The running screen takes the whole page. It shows the
stages from the server's `progress` events, and nothing fakes a percent.

**State C, result.** Zones, from the top:

The page shows no count of checks and no grade. A count of files can't show that
an AI will work well on a repo: a test with junk files passed the same checks as
real ones, and adding our own `AGENTS.md` raised the count. `resultScreen` in
`view.ts` picks one screen from the `rules` step, `fixes` and the `saved=1` flag.

1. The top: the repo, the saved date, "Run it again" and "Copy link". Then what the
   AI understood, in three columns taken from the `### ` parts Muse wrote: how to
   build it, how to test it, what not to touch.
2. One task zone: "Is this right? Save it to your project." Four exclusive `details`
   with only the current one open: copy the file, paste it, save it, check that it
   saved. The first says where the reader is and what to click. The site can't
   see GitHub, so a step marked done changes only the list. The saved file holds
   only what the reader just read (`savedFileText` in `fixes.ts`). yokoten's whole
   template names checks and tools a repo without yokoten doesn't have, so a reader
   must not commit it.
3. "Check that it saved" runs a new check with `saved=1` and shows one of three
   screens: saved, with a question to try on the reader's own AI tool; one more
   line, when a `CLAUDE.md` still has to import `AGENTS.md`; or not found, with a
   way back to the steps. A saved example has no steps, because it is someone
   else's project.
4. Other screens: already has an `AGENTS.md`, too big for the AI to read, and the AI
   failed. The last two offer the template, because nothing was written.
5. "More details": quiet rows that each open real content. Files we looked for (the
   8 checks a repo can pass without yokoten, marked "Not a grade"), other files, "Is
   this meant to be public?", "Confirm this result", the repo summary, marked as by
   Muse, and "Optional: yokoten" (the other 5 checks, never shown as missing).

A file row has one button, in one column, and the one filled button in a step is
"Done, next step". A long file gets "Copy and open GitHub": one click copies it,
then opens the new-file page. A check that `yokoten init` alone makes pass
counts under the install step, so one command never shows twice on a page.
The function `resultPlan` in `web/src/client/view.ts` decides all of this.

Every page uses one container width from one token, `--wide`. Blue means you can
press it, green means passing, yellow means needs work, and red is only for a
run that stopped.

Mobile width works. No sign-in, no cookies apart from what the host needs.

## 5. Checks

The page has no checks of its own. The sandbox runs
`yokoten doctor --all --json` and `yokoten check --json` and the page shows
what they return.

`doctor --json` (seen on yokoten 0.1.2) gives `steps` (each `id`, `stage`,
`mark`: done / to do / next / can't check) and `findings` (each `id`, `what`,
`why`, `fix`). The page uses these fields as they are, with three rules
(confirmed on yokoten main, 2026-10-29; a contract test pins these keys and
types for v0.2.0, and new keys may only be added):

- Key everything on `steps[].id`. `findings` also holds notes that are not
  steps, so look a step's finding up by id; never walk `findings` as the list.
- Exit codes 0 and 1 are both normal. Under `--all` a 1 means some step is to
  do; under `--files` it comes only from a failed self-test or core rules that
  are behind (the tree check does not run there; the page runs `check --json`
  on its own). The runner reads the JSON on stdout and treats only bad JSON
  or a timeout as a failure.
- With no network in the sandbox, the server steps come back "can't check"
  ("gh is not installed") in about half a second; the page shows them as
  "needs your machine".
- Fields read (agreed with the yokoten lead 2026-10-29; pinned for outside
  readers by yokoten issue #1202, fields may be added, never renamed,
  removed or retyped): doctor top `version`, `stage`, `next.id`; `steps[]` `id`,
  `stage`, `mark` with exactly "done", "to do", "next", "can't check",
  "not now" (the repo's yokoten.json skips the step on purpose; it then also
  carries `reason`, shown as "skipped on purpose: <reason>"); any other value
  shows as "unknown" instead of failing the page;
  `findings[]` `id`, `what`, `why`, `fix`, optional `docs`. check top `ok`;
  `findings[]` `id`, `what`, `file`, `line`, `grade`, `why`, `fix`, where
  `what` never holds the secret value.
- A done step has no text in 0.1.2. yokoten issue #1203 (v0.2.0) adds an
  optional `how` and `why` to every `steps[]` entry, the same text
  `yokoten explain <id>` prints; the "How this was judged" fold shows it.
- The release is v0.2.0, not v0.1.3 (owner, 2026-10-30, because `doctor
  --files` is an added feature); tagged at c77d6e7c4, on npm. Pin
  `yokoten@0.2.0`. Run on the published package on this repo (2026-10-30): 13
  steps, all source "files", each with `id`, `stage`, `mark`, `how`, `why`,
  `source`, `title` (and sometimes `standard`); `next` is a files step; exit 0.
- yokoten's contract test pins `doctor --all --json`, not `--files`. So the
  server pins the exact version, and this repo keeps its own test on a saved
  `--files` output from 0.2.0; moving to a newer yokoten means that test first.
  Do not read `channel`.

**File-based steps.** These are judged from the repo's files alone, so anyone
who re-runs the same yokoten version on the same commit gets the same mark:
`rules`, `runtime`, `tests`, `ci`, `issues`, `templates`, `no-build-output`,
`changelog`, `titles`, `codeowners`, `security-files`.

**Needs your machine.** These read the user's own machine or need admin access
to the repo, so the sandbox cannot judge them and the page does not promise
them: `tool-hook`, `commit-check`, `remote`, `bot`, `skills`, `sandbox`,
`labels`, `milestone`, `review`, `protection`, `merge-settings`,
`security-settings` and the release steps. They show as "needs your machine",
with the `npx yokoten` line.

(The split above is read from yokoten's `src/setup/road.ts` today. If a later
yokoten moves a step, the page follows yokoten, not this list; a test fails if
a step id in the list is no longer in doctor's output.)

**From v0.2.0 the split comes from yokoten itself** (yokoten lead, 2026-10-31):

- Each step in `doctor --json` gains `source` and `title` (additive; nothing
  pinned is renamed or removed). `source` has three values (yokoten lead,
  2026-10-31, from the built issue #1256):
  - "files", 13 steps: rules, tool-hook, runtime, tests, ci, issues,
    templates, no-build-output, changelog, titles, codeowners, sandbox,
    security-files. Judged on the page.
  - "host", 9 steps (labels, milestone, review, protection, merge-settings,
    security-settings and the release steps): shown as "needs GitHub
    settings".
  - "machine", 4 steps (commit-check, remote, bot, skills): shown as "needs
    your machine".
  The page drops its own list above and never hard-codes a step count; "done
  N of M" counts the "files" steps yokoten returns.
- Under `--files`, `lessons` and `server` are empty arrays and `notes` holds
  at most the core-rules note; the page ignores all three.
- `next` is the page's main card. Asked of yokoten issue #1256 (to be pinned
  by a test): under `--files`, `next` and `stage` come from the files steps
  only. The page still guards it: if `next` names a step whose `source` is not
  "files", it shows the first files step in road order that is not done.
- `title` is on every step in every doctor run, `--all` included (yokoten
  lead, 2026-10-31), so the fallback path has titles too.
- Seen on yokoten main after PR #1265 (2026-10-30, run on this repo): 13
  steps, all `source` "files", each with `title`, `how`, `why`; `next` is a
  files step; exit 0; `notes`, `server`, `lessons` empty.
- Five files steps are not fixed by the page's patch, because they need
  yokoten installed and the patch leaves them out (6.2a): `tool-hook` (the guard
  in the agent configs), `runtime` (`.yokoten/`), `sandbox` (the agent sandbox
  configs), `ci` (CI runs `yokoten check`) and `titles` (CI runs
  `yokoten check --pr`). The page lists them under "Optional: yokoten", with
  `npx yokoten init`. A repo doesn't need them, so the page never shows them as
  missing. The API's `summary.done` and `summary.total` still count all 13, because
  saved records hash the raw result.
- `yokoten doctor --files --json` (yokoten issue #1256, planned for v0.2.0)
  judges from the checkout's files only: no code-host read, no gh, no
  network, no machine notes, and host steps are left out. The sandbox runs
  this instead of `--all`, so every mark on the page is one anyone can re-run
  anywhere.
- If issue #1256 misses the tag: run `doctor --all --json` and keep only the
  steps whose `source` is "files" (or, without `source`, the list above).

**Secrets.** `yokoten check --json` runs on the same copy. A secret hit is shown
first, above everything else, with yokoten's masked text only; the value is
never shown or sent to Muse. (Wallet keys are not found yet; that is yokoten
issue #1168.)

Known yokoten misreads that show up on real repos (Foundry tests, Renovate,
Changesets and more) are yokoten issue #1167; the page shows what yokoten says
and does not patch around it. The demo repos are picked with that in mind.

## 6. Architecture

```
browser (static page)
   │  POST /api/check {url}
   ▼
API (Modal web endpoint) ── Baseten: Muse Spark Open (summary + files)
   │  starts one sandbox per check
   ▼
sandbox (Modal, throwaway): git clone --depth 1 → yokoten doctor/check --json
   │  returns the JSON and the few files Muse may read
   ▲
streamed events (server-sent events) back to the browser
```

- One repo, in the owner's personal GitHub account, holds web and server.
- Web: static files in `web/`, on any static host. Served at
  `doctor.yokoten.app` (owner, 2026-10-29). Trust does not rest on the host
  (section 6.4).
- Server: Modal, which gives one throwaway sandbox per check. At most 3
  containers, and 10 requests in each, so a flood queues instead of spending.
- Limits: 10 checks per address per hour and 300 per day in all. The address is
  stored only as a hash. A bad URL costs nothing.
- yokoten version: pinned to one exact release in `server/check/sandbox_run.py`
  (v0.2.0), so the re-run command gives the same result. A new release means
  changing that line and deploying again. The version used is written into every
  result. Nothing is fetched at check time.
- Language (decided 2026-10-30, replaces the TypeScript page of 2026-10-29):
  plain JavaScript with `// @ts-check` for the web page and its tests, so there
  is no build step; a small Python app on Modal for the server (receive the URL,
  start the sandbox, call Muse, stream back). Modal's web endpoints and Functions
  are Python only; its JS SDK (npm `modal`) can drive sandboxes but cannot define
  an endpoint, so a TypeScript server would need a second host. This is a
  stated exception to the owner's "no new Python in TS projects" rule, kept
  to `server/`. Modal credits: claimed, valid during the hackathon only.
- Deploy: `modal deploy server/app.py` uploads that one file, so `web_image` adds
  the sibling modules with `add_local_file`. Modal builds the web address from
  the workspace name, so the workspace is named `yokoten-doctor`, and the page
  calls that address directly with no proxy.
- Secrets live only in the server's secret store, never in the repo, never in
  the browser, never inside the sandbox, never in a Muse prompt:
  `BASETEN_API_KEY`.

### 6.1 The sandbox run

- Accept `https://github.com/<owner>/<repo>` (with or without `.git`, a trailing
  slash, `/tree/<branch>`). Anything else: a plain error.
- Ask GitHub (public API, no token) whether the repo is public, its default
  branch and size. Private or over 15 GB of history: stop with a plain message.
- In a fresh sandbox:
  - `git clone --depth 1 --no-recurse-submodules` with hooks off
    (`-c core.hooksPath=/dev/null`), then note the commit;
  - `yokoten doctor --all --json` and `yokoten check --json`;
  - read the files Muse may see: README, AGENTS.md, CLAUDE.md, the package file
    (package.json / pyproject.toml / Cargo.toml / go.mod / foundry.toml /
    Anchor.toml / Makefile, whichever exist), the workflow files, CODEOWNERS,
    the first 3 KB of CHANGELOG.md. Each cut at 20 KB, 120 KB in all.
- The sandbox never runs the repo's own code: no install, no build, no tests,
  no scripts. It has no secrets. Limits: 2 minutes, 1 CPU, 1 GB memory, 1 GB
  disk. Destroyed after the run.
- Two rules taken from the yokoten desk, whose recent bugs came from exactly
  these (owner's yokoten lead, 2026-10-29):
  - Network to an allowlist only: GitHub for the clone, and nothing at all
    while yokoten runs. doctor then skips the GitHub-settings steps; yokoten
    v0.2.0 has a test that it does so without waiting or failing.
  - A writable temp folder of the sandbox's own, set in `TMPDIR`, `TEMP` and
    `TMP`.
- Never read or send to Muse: anything matching `.env*`, `*.pem`, `*.key`,
  `id_*`, `*keypair*.json`, or any file a `check` hit points to.

### 6.2 Muse at run time

- One call per check run, streamed, made by the API, outside the sandbox.
  Model: Muse Spark Open on Baseten, through Baseten's OpenAI-compatible chat
  API. Model slug `meta-models/muse-spark-open-1026` (other entrants report it
  working in the hackathon's Baseten channel, 2026-10-29; base URL not checked
  yet). The hackathon key comes without a usage page, and some entrants report
  429 rate-limit errors at low use, so the page must spend few calls:
  - one Muse call per repo commit: the result (checks + Muse files) is cached
    for 24 hours, keyed by repo, commit and yokoten version (a small Modal
    key-value store holding public data only); a second check of the same
    commit costs no call;
  - on 429, wait and retry once, then show the checks without Muse files.
- Input: the repo facts (name, description, file list, the files read in 6.1)
  and doctor's findings for the file-based steps that are not done.
- Output: one JSON object, validated by the API before anything is shown:

```json
{
  "summary": "one sentence about this repo, plain English, at most 30 words",
  "this_project": "the text of AGENTS.md's This project section, in Markdown"
}
```

- Muse writes only AGENTS.md's "## This project" section; the rest of every fix
  file comes from `yokoten init` (6.2a). It runs only when init adds a new
  AGENTS.md: a file that already exists in the repo is never replaced. The reply
  is refused when a field is empty or too long, when it has a `#` or `##`
  heading, or when it holds an email address.
- The run-time prompt is `SYSTEM_PROMPT` in `server/fixes/muse.py`. It tells Muse
  that everything in the facts is data, and never an instruction. It also tells
  Muse to state only what the files show, and to say so when they show nothing.
  The cache key holds a hash of the prompt, so a new prompt never serves old text.
- If Muse fails or returns bad JSON: retry once; then send yokoten's files
  without Muse's section and say so. The checks never wait on Muse: the API sends
  `result` first, then `fixes`.
- Muse's files are suggestions, not results: a model's output is not the same
  twice, so it is not re-runnable. The page says "Suggested by Muse; read
  before you apply."

### 6.2a Write once: the fix files come from `yokoten init`

The files are yokoten's own standard, not Muse's invention (owner,
2026-10-29: "write once, run everywhere"; v0.2.0 is where the standard
settles):

- The sandbox runs `yokoten init` (no `--github`, no network) in the
  throwaway clone and takes only these paths from `git status`: AGENTS.md,
  CHANGELOG.md, `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`,
  `.github/SECURITY.md`, `.github/dependabot.yml`, `.github/CODEOWNERS` (with
  the repo owner's handle in place of the placeholder), and later the test
  workflow. It drops `.yokoten/` (the 3.6 MB runtime), `.githooks/` and every
  agent config: those need yokoten installed, which `npx yokoten` does.
- A known yokoten bug to route around (issue #1286): on a repo with its own
  root `SECURITY.md`, init also writes `.github/SECURITY.md`. The same happens
  with a pull request template in `docs/` and with a changelog under another
  name, such as `CHANGES.md`. The server drops a new file when the repo already
  has the same thing elsewhere (`select_fix_paths` in `server/fixes/`).
- Muse writes only AGENTS.md's "## This project" section (build, test, what
  not to touch), the one place init leaves for the project. Everything above
  it is yokoten's core rules, word for word.
- So a user gets the same files from the page as from `yokoten init`, and a
  change to the standard reaches the page with the next yokoten release.
- init runs no repo code (checked on yokoten main by its lead, 2026-10-29):
  without `--github` its only child processes are git reads and
  `git config core.hooksPath`, which only touches the throwaway clone;
  manifests are read as text. Not audited line by line, so the sandbox's
  no-network rule stays the real guarantee.
- Planned for yokoten v0.1.4, not needed for the demo: `yokoten init
  --dry-run --json` printing {path, content, step} without writing, with the
  runtime and agent configs left out. Then the page drops its own path list,
  and the list lives only in yokoten.

### 6.3 Patch

Built in the browser from `files`: a unified diff that adds each file (and the
one-line CLAUDE.md change), downloadable as `yokoten-doctor.patch`. The page
shows `git apply yokoten-doctor.patch` under the button.

- The patch is made against the commit that was checked (shown on the page).
  It only adds files (plus the one CLAUDE.md line), so it still applies after
  main has moved on; if someone added a same-named file meanwhile, `git apply`
  stops with an error and overwrites nothing.
- First, for beginners (shown first, largest): each generated file gets an
  "Add on GitHub" button. It opens GitHub's own new-file page for that repo
  with the file name and content filled in
  (`https://github.com/<owner>/<repo>/new/<branch>?filename=<path>&value=<content>`);
  the user reads it and clicks "Commit changes", choosing a new branch and a
  pull request. No install, no terminal, and we still hold no write access.
  GitHub accepted a 6,000-character link and failed from 7,000 (measured without
  a login, 2026-10-31). A file too long for the link, such as AGENTS.md, gets one
  button, "Copy and open GitHub": it copies the text, then opens the new-file
  page with the name filled in.
- Then the patch download above, folded.
- Last, folded, a copyable block turns the patch into a pull request from
  the user's own machine, with the user's own account (we still hold no write
  access):

  ```
  git switch -c yokoten-doctor-fixes
  git apply --index yokoten-doctor.patch
  git commit -m "docs: add agent rules from yokoten doctor"
  git push -u origin yokoten-doctor-fixes
  gh pr create --fill
  ```

### 6.4 Check it yourself (re-run)

Nobody has to trust the server, as with Sourcify, Solana verified builds and
OpenSSF Scorecard: the hosted run is a convenience, and anyone can re-run it.

- Every result carries: the repo, the full commit hash, the exact yokoten
  version, and the command:

  ```
  git clone https://github.com/<owner>/<repo> && cd <repo>
  git checkout <commit>
  npx yokoten@<version> doctor --files --json
  ```

- With `--files` (v0.2.0, issue #1256) the whole output must match, on any
  machine. Without it (fallback: `--all`), the promise is for the file-based
  steps only, and the page says so next to the command.
- The secret check (`check --json`) reads no network, but its privacy rules
  also use what the machine knows: the user's own private-marks file, the git
  user name and the home folder path (yokoten lead, 2026-10-31; read from the
  code, not tested offline). The sandbox has none of these, so its result is
  repo-only; on a user's own laptop the same command may add findings from the
  user's own marks. So the page's re-run line for check uses a throwaway home
  folder:

  ```
  HOME="$(mktemp -d)" npx yokoten@<version> check --json
  ```

  The page shows both commands in one box, in order, because `check` must run
  in the same folder. (A matching mode in yokoten may come later; noted on
  yokoten issue #1256.)
- The result JSON (what the page shows, minus Muse's files) can be downloaded,
  with its SHA-256 shown, so a user can keep it and compare later.

### 6.5 Optional, if time is left: a public record of each check

The owner supports recording every check publicly. Only if steps 1–7 of the
build order are done. What is recorded: repo, commit, yokoten version, time and
the SHA-256 of the result JSON. No file contents, nothing private.

Two records, both free (decided by the owner 2026-10-28: Solana devnet):

1. **Sigstore Rekor** (public, append-only transparency log; yokoten already
   uses it for `check --anchor`). The server signs with a signing key kept in
   its secret store; no money behind it. This is the lasting record.
2. **A Solana devnet memo transaction** carrying the same hash, the repo, the
   commit and the yokoten version, through
   Solana's built-in Memo program: one transaction per check, readable in any
   Solana explorer set to devnet. Devnet SOL comes free from the faucet and is
   worth nothing, so the server's devnet wallet key cannot lose real money.
   Devnet can be reset, so this record may disappear; Rekor stays. Mainnet is
   a later decision of the owner's, not part of this build. Claude and Muse
   never move funds on any network.

The server writes both. The result page links to one entry: Rekor, or the
Solana memo, labelled as a test network, only when Rekor is missing.

## 7. Safety and abuse

- Public repos only; checked through the GitHub API before cloning.
- Rate limit: 10 checks per IP per hour, 300 per day in all. Over the limit: a
  plain message and the `npx yokoten` line.
- Size caps in 6.1; over 20,000 files: checks only, no Muse.
- The sandbox runs no repo code and holds no secrets (6.1).
- Everything from the repo, from yokoten or from Muse is shown as text,
  escaped; nothing is put into the page as HTML.
- No logs of repo contents. Logs keep only: time, owner/repo, commit, yokoten
  version, marks, durations, error type.
- Meta's free credits may use content for product improvement. Only public repo
  content goes to Muse, and the privacy line says so.

## 8. Repo layout

```
web/index.html, web/style.css
web/view.js              what to show, with no DOM; tested in Node
web/fixes.js             patch and GitHub links (6.3), with no DOM; tested in Node
web/app.js               DOM and network
server/                  Modal app: API, sandbox run (6.1), Muse (6.2), record (6.5)
test/web/                page states with saved doctor JSON, patch building
test/server/             URL parsing, JSON validation, path filter, file-based list
test/fixtures/           doctor and check JSON saved from real runs
README.md, LICENSE (MIT), SECURITY.md, AGENTS.md
```

Most tests run on saved JSON, with no network, no Modal and no Muse.

## 9. Build order (each step is one Muse task, reviewed by Claude)

1. Repo base: README (with "run your own copy": your own Modal and Baseten
   keys), MIT LICENSE, AGENTS.md, CI running the tests. The repo passes
   yokoten's own file-based steps (eat our own food, and it shows in the demo).
   Server in Python on Modal, web in plain JavaScript (section 6).
2. The sandbox run (6.1), returning doctor and check JSON for a URL. No page,
   no Muse.
3. The API with streaming, and the page states A, B, C with yokoten's results
   only.
4. "Check it yourself" (6.4).
5. Muse (6.2): streaming, JSON validation, path filter.
6. Fix cards and the patch download.
7. Rate limit, error states, mobile check, deploy.
8. Optional, if time is left: the public record (6.5), Rekor first.
9. Optional, cut first: the ask box (below).
10. Demo video.

**The ask box (optional).** One input under the result: "Ask about agent
safety in this repo". Muse only picks which yokoten step the question is about
(one of the step ids, or "none"). The answer shown is yokoten's own text for
that step (what, why, how), word for word, under the label "Answer from
yokoten's rules, not generated". "none" gets a fixed reply that points to
`npx yokoten`. Rule code is never presented as a model.

Done when, for the whole page: on three real public repos (one bare, one half
ready, one fully ready) a check finishes in under 60 s; the patch applies with
`git apply` on a fresh clone; the re-run command in 6.4 gives the same marks
for the file-based steps; and `npx yokoten doctor` on the patched clone shows
the patched steps as done.

## 10. Later (not for the hackathon)

- **Results from the project's own CI** (the OpenSSF Scorecard model): the
  project adds the yokoten GitHub Action; the run is signed with GitHub's OIDC
  identity through Sigstore and logged in Rekor, as yokoten's own anchor
  workflow already does; this page gets a lookup ("show the signed result for
  this repo") and a README badge. A private repo never goes into a public
  record (Rekor or a chain): even a hash entry names the repo and its commit.
  Private repos use the CLI or the Action in their own CI only; this page
  never touches them. yokoten issue #1205 makes this a rule in yokoten (refuse a
  private repo, fail closed when visibility can't be read) and blocks
  offering anchoring or CI-signed results to users until it lands. Strongest proof for web3 users. Mostly
  yokoten repo work; worth a place in yokoten's own plan.
- A files-only mode in `yokoten doctor`, so a re-run on any machine gives the
  same output with no "needs your machine" steps. yokoten repo work.
- Open a pull request for the user through a GitHub App: smallest scope, a new
  branch only, never the default branch, no token kept.
- A link from yokoten.app, added by the site lead once this page is stable.

### yokoten's one sentence

The page's closing line uses yokoten's one sentence and first command, the
same text as its README, npm description and site (yokoten PR #1266, issue
#1139): "yokoten stops your AI coding agent from making the mistake you can't
undo. One command, no setup." and `npx yokoten`. The page reads the sentence
from the installed yokoten package's `description` at build time, not from a
copy, and a test fails if the page shows any other wording (one source for
public text).

### Beginner-friendly wording (agreed with the yokoten lead, 2026-10-31)

- Each step shows yokoten's own plain task title first ("Write the rules for
  your agents (AGENTS.md)", "Run your tests on every push"), the step id small
  underneath. The titles come from yokoten (`STEP_TITLES`, at most 60
  characters, tested); yokoten issue #1256 adds `title` to each JSON step. The
  page writes no titles or rephrasings of its own.
- Wording follows yokoten's screen rules (record 0049): plain words, the next
  step as one full sentence, one fix per problem, no jargon before the step
  that needs it. The terminal-only layout parts (80 columns) do not apply.
- Input: a full URL, `owner/repo`, a URL with `/tree/<branch>` or `.git`; one
  plain error for anything else.
- People who don't code have no repo. For them the page says in one sentence
  what an AI agent can break and shows an example result; nothing more is
  promised.
- English only for the hackathon. Other languages come later together with
  yokoten's titles and how/why, under the site's four-language rule.

## 11. Demo (3 minutes)

Story outline agreed with the owner 2026-10-29, edited 2026-10-30; only what
runs on the live page that day is shown, and the live part is also recorded
as a backup video.

1. (0:00, 20 s) The problem: "Your repo looks fine to you. To an AI agent,
   it's full of traps."
2. (0:20, 50 s) Paste a real public repo. The page reads like `yokoten
   doctor`: steps done, the next step, the rest folded; each check says how it
   was judged.
3. (1:10, 60 s) The fix is yokoten's own standard; Muse writes AGENTS.md's
   "This project" section with the repo's real commands, and the fold shows
   what was sent to Muse. "Add on GitHub" (or the patch), then `npx yokoten
   doctor`: the step turns done. "The model writes. The engine judges."
4. (2:10, 25 s) The evidence card: yokoten version, commit, command. "Don't
   trust us. Re-run it." (File-based steps only.)
5. (2:35, 25 s) Close: Muse wrote most of this page's code; yokoten was built
   before the event and does the checking; Claude designed, planned and reviewed.

The video is made as code, so it can be remade whenever the page changes:

- yokoten's site already has the pipeline (`web/site/tools/promo` in the
  yokoten repo): Remotion renders the video; terminal scenes are drawn from
  real screens captured at a release tag (`screens.json`), never typed by
  hand; captions with timings live in one strings file; `.vtt` tracks are
  written for them.
- The doctor video reuses it: the `npx yokoten doctor --files` scene is
  captured the same way at v0.2.0; the live page scenes are recorded from the
  real page with Playwright; one story file in the strings-file shape feeds
  both. Captions only, no voice, by default.
- The video composition lives in the yokoten repo's promo tools
  (`web/site/tools/promo`), not in this one (owner, 2026-10-30), and lands
  there through a normal yokoten pull request; this repo holds only work done
  during the event.

Say it right in the pitch: the version is 0.2.0 (there was never a v0.1.3); the
npm page's README sample still says 0.1.3 until the next tag; yokoten is not
listed in the Claude plugin directory or GitHub Marketplace yet, so claim
neither. The page shows no count. A local `yokoten doctor` says "N of 26 steps".

Bonus target: Best Build on Meta Open Weights. Not Best Agentic Use-Case: one
Muse call per check is not an autonomous agent.

## 12. Open questions for the owner

- Subdomain `doctor.yokoten.app`: decided 2026-10-29; the owner adds the DNS
  record when the page is deployed.
- Modal: the hackathon credits must be claimed through the approval email.
- The public record (6.5): decided, Rekor plus a Solana devnet memo; mainnet
  later, only if the owner decides.
