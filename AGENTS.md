<!-- yokoten kit 0.2.0 -->
# How work is done here

This file is for every agent and every person working in this repo. It starts from
[yokoten](https://github.com/yokoten-labs/yokoten)'s core rules; the project's own section is
at the end.

Every rule names why it exists and the check that holds it. A rule with no check is a
wish: the check is what makes it true on a busy day. The "why" is an **incident** when
one happened, and a **risk** when the rule came first. Incidents are never made up; a
risk becomes an incident only when it happens. When a rule here fails, use the `rca`
skill: find the cause, add or fix the check, then carry the fix to the other projects.

## Roles

- **The owner** decides what is built and when it ships. Only the owner approves a pull
  request that touches a hard line (a CODEOWNERS path, such as the release), creates release
  tags, and changes repo settings. Another tier A pull request merges once a reviewer of
  another model approves it and every check passes.
- **The lead** is the session the owner talks to. It plans, splits the work, reviews,
  commits and opens pull requests (as the bot, never as the owner).
- **A worker** is a session the lead starts for one task, in its own worktree, with
  `YOKOTEN_ROLE=worker`. It changes code and tests, and reports back. It never pushes.

## Core rules

| # | Rule | Why | Check |
|---|------|-----|-------|
| 1 | Every piece of work starts as an issue. No todo files. | Incident: follow-ups written only in chat reports were nearly lost; a shared todo file made one PR run CI four times on merge conflicts. | `doctor` reports todo files |
| 2 | Nothing reaches `main` without a pull request and green CI. | Risk: one bad push breaks every branch built on it. | Branch ruleset on the server |
| 3 | Only the owner creates tags and releases. A general "merge", "ship it" or "go ahead" does not approve a release. Only an owner request that names the version or says "release", "publish" or "tag" does. | Risk: when to ship is the owner's call, and a pushed tag can start a release. | Tool guard; tag ruleset on the server |
| 4 | A fix task changes code, never tests (`YOKOTEN_FIX_TASK=1`). | Risk: the fastest way to make a test pass is to change what it asserts. | Tool guard and commit check |
| 5 | A worker does not change lead-only files: these rules, agent config, hooks, CI. | Risk: a pull request that edits CI runs that CI before anyone reads it. | Tool guard and commit check for workers; for the bot, no Workflows permission, or CODEOWNERS review of CI changes with every secret behind a protected environment |
| 6 | Never skip the commit check (`--no-verify`, changing `core.hooksPath`). | Risk: a skipped check makes a broken commit look reviewed. | Tool guard; CI runs the same check |
| 7 | No plain force push. Merge `main` into a branch only on a real conflict; never rebase a shared branch. | Risk: a force push throws away commits someone else pushed. | Tool guard; branch ruleset |
| 8 | Squash merge. One pull request, one purpose; small polish goes in one batch. A pull request has a commit-form title, a `tier:` line, Why / What changed / How tested, a linked issue, a file in `changes/` when behaviour changes, a milestone, a type label, and a tier label that matches the `tier:` line. An issue title is `area: verb phrase` (a task) or `area: symptom` (an incident): at most 60 characters, no full stop, no `#N`. | Incident: the owner was asked to review a +3 −2 pull request on its own and said small changes should not each cost a review. | Repo settings (squash only); `check --pr` and `check --issue` in CI |
| 9 | Review and test the exact commit that merges. The reviewer only reads; the verifier runs it. | Incident: two pull requests, each green on its own, broke `main` together, twice. | `inspect` skill; merge queue where the host has one |
| 10 | No folder holds more than 7 entries (the root is not counted). | Risk: a flat folder grows until nobody can find anything. Set as a standard by the owner. | Commit check (layout) |
| 11 | Nothing in the repo, or in what yokoten prints, points at a person or opens their accounts: no personal email, IP, name, city or private domain, and no secret (token or private key). A hit is reported by place, never by content; the home folder shows as `~`. | Incident: the old check read only the live docs, and server names and addresses were still in 56 tracked files. | Commit check and CI (privacy and secrets); `check --history` before going public |
| 12 | Decisions are written down once and kept. A changed decision gets a new entry that points back. Facts are replaced, not added to. Times are UTC, commit times included. | Risk: a decision that lives only in a chat gets argued again. Incident: every commit recorded the owner's time zone (#40). | `record` skill; commit check (commit time) |

## Writing

Plain English, close to ASD-STE100 (Simplified Technical English), because the readers
include beginners, people reading a second language, and agents. An instruction has at
most 20 words; a description at most 25. One instruction per sentence. One word for one
thing. Active voice. A flow gets a diagram. `check --pr` notes long sentences in changed
Markdown; a note never fails CI.

## Names

A name is what a reader meets first and reads most. Pick names that a new reader, or an
agent, understands without scrolling back. The yokoten guide says why:
[Naming](https://github.com/yokoten-labs/yokoten/blob/main/docs/guide.md#naming).

- Whole words. A short form only when everyone knows it (`id`, `url`, `config`). Never
  delete letters inside a word.
- At most 4 words. There is no character limit, because a limit makes people abbreviate.
- One letter only for a name used within about 10 lines, such as a loop counter.
- A function's name starts with a verb. A true/false value starts with `is`, `has` or
  `can`.
- One idea keeps one name in every file.
- Use the language's own case style, for example `camelCase` in TypeScript and
  `snake_case` in Python.

| Hard to read | Easy to read | Why |
|---|---|---|
| `r`, still used 30 lines later | `result` | By line 30 the reader has forgotten what `r` holds. |
| `cfgMgr` | `configManager` | Letters cut from inside words make the reader guess. |
| `processTheUserInputDataNow` | `parseInput` | Six words, and three of them say nothing. |
| `valid` | `isValid` | `is` says the value is only true or false. |

## Where to look

| For | Read |
|-----|------|
| Why something is the way it is | `docs/records/` |
| Handing a task to a worker | the `dispatch` skill |
| Reviewing a pull request | the `inspect` skill |
| Something went wrong | the `rca` skill |
| What this repo is missing | `yokoten doctor` |

## This project

This repo holds the web version of `yokoten doctor`: a static page in `web/`
and a small Python service in `server/` that runs on Modal. The design is in
`docs/design.md`.

### Build

- Web: Astro and TypeScript in `web/src/` (`web/src/pages/index.astro`, `web/src/layouts/Page.astro`, `web/src/components/*.astro`, `web/src/styles/global.css`). Client code is in `web/src/client/`. Run `npm run build` to write the site to `dist/`, and `npm run typecheck` to check types.
- Server: Python in `server/`. Its runtime dependencies are `modal`, `fastapi` and `cryptography`, listed in `server/requirements.txt`. The entry point is
  `server/app.py`. A merge that changes `server/` deploys it, by `.github/workflows/deploy-server.yml`.

### Test

- `npm test` builds first through `pretest` and then runs the web tests in `test/web/` (Node 22.23.4 or newer, no runtime dependencies to install).
- `python3 -m pytest test/server` runs the server tests in `test/server/`.
  Use the project environment in `.venv` when the system Python has no pytest:
  `python3 -m venv .venv`, then `.venv/bin/python -m pytest test/server`.
- `python3 -m pytest test/server test/record` runs the server tests in `test/server/` and `test/record/`.
  Use the project environment in `.venv` when the system Python has no pytest:
  `python3 -m venv .venv`, then `.venv/bin/python -m pytest test/server test/record`.
- Most tests run on saved JSON in `test/fixtures/`, with no network, no Modal
  and no Muse.

### How a change reaches main

- Work starts as an issue with an area in its title, a type label and a milestone.
- `yokoten bot --` opens every issue and pull request. The owner's account only approves.
- The `pr` check holds the title, tier, sections, issue, change file, milestone and labels.
- The `review` workflow asks DeepSeek 4.1 Flash to review each pull request, as `yokoten-reviewer[bot]`.
  The reviewer is never a model that writes code here, so it is never Muse or Claude.
- The lead (Claude Opus 5.5) reads every pull request. It turns on auto-merge in the step right after opening one, and never after a review has ended unless it has read that review.
- Auto-merge merges when `test`, `pr` and `review` pass. The lead reads each review, and fixes what it finds in a new pull request.
- The `review` check fails when the reviewer can't read the model's answer, and that also turns auto-merge off. A high finding turns it off too, so the lead decides.
- A diff too large to review fails the `review` check until a person approves that commit and the check runs again. Incident: PR 103 merged with no review, because the check only tried to turn auto-merge off.
- The owner approves only a pull request that changes a CODEOWNERS path.
- The bot squash merges in UTC. A merge to main deploys what it changed: the page, the server, or both.

### Only Muse writes site code

Muse Spark Open writes all code in `web/`, `server/`, `test/` and the root config files. There are no exceptions, even for one line.

- Why. Incident: the owner set this rule, and the lead still wrote PR 90's changes by hand. It then asked whether one or two lines could be an exception.
- Roles. Claude designs, briefs Muse, applies its reply, reads the diff and runs the tests. Claude does not write this code.
- CI files, `AGENTS.md`, docs and JSON config stay with the lead. Deleting a file writes no code, so the lead can delete one.
- A wrong reply goes back to Muse with a new brief. Nobody fixes it by hand.
- Each new brief for a long file starts from a clean git copy. Read each reply as a diff before applying it.
- `apply-json.mjs` compares the files with Baseten's reply. It then writes them and records each hash in `muse-receipts.json`. It refuses a reply that doesn't parse, changes only backslashes, or drops a click handler, clipboard call or `window.open`.
- Check: the `test` workflow fails when a changed code file has no receipt, or differs from its receipt.
- Check: a local hook refuses Claude's file tools on these paths.
- These checks stop mistakes. They do not prove authorship to an outsider, because a receipt can be forged by hand.

### What not to touch

- No secrets in this repo: no keys, tokens, `.env` files or private marks.
  Server secrets live only in the server secret store.
- No yokoten code copied in: yokoten is a pre-existing tool used as an npm
  dependency (`yokoten@0.2.0`) at run time. Do not vendor `.yokoten/`,
  `.githooks/` or any agent config from `yokoten init`.
- Never run a scanned repo's code: no install, no build, no tests and no
  scripts from a repo this page checks. The sandbox only clones, reads files
  and runs yokoten on them.

### Rules for writing code here

These come from mistakes already made in this repo. Each one was caught in review or by a check.

- Return every test that was in a file. Never drop a test to make a file shorter.
- Copy untouched lines byte for byte. Keep regex flags, escapes and quotes.
- Tests use only `node:test` and `node:assert/strict`, or `pytest`. Add no test framework.
- Test data uses `example.com` for email and `192.0.2.0/24` for IP addresses. The commit check refuses others.
- A task that adds a file type or a folder also updates the test that limits them.
- A worker thread always puts a final item on its queue, so a reader never waits for a time limit.
- When an optional step fails, say so once and end. Check what the reader does in that case.
- Leave no comments that think out loud, no branches that cannot run, and no repeated blocks.
- A module on Modal must be in `web_image`. A test that imports it does not prove the deploy works.
- Client code uses only TypeScript syntax that Node can strip, and imports name the `.ts` file.
- Text a visitor reads on the site is natural American English. The Writing rule above covers rules and docs.
- A page that promises a screen gives a way to reach it, and a test walks the visitor's route there. Incident: the first example hid the save steps, and step 4 promised screens nobody could reach.
- Page logic that reads yokoten's words is tested on real output in `test/fixtures/`, captured from the version the server runs.
- What a visitor saves is what they read. Incident: visitors committed yokoten's template, which names checks their repo doesn't have.
