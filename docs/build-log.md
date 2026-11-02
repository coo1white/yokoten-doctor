# Build log

This counts how many rounds of fixes each task needed after the first code came back, and what found the problem. Counted from the task files on 2026-10-31.

| Task | Fix rounds | Found by |
|---|---|---|
| 1. Repo base | 1 | test |
| 2. Sandbox run | 1 | review |
| 3 and 4. API and page | 4 | review, test, real deploy, real page |
| 5. Fix files and Muse | 2 | review, test |
| 6. Fix cards and patch | 2 | review, commit check |
| 7. Limits and Pages | 3 | test, commit check, test |
| 8. Public record | 2 | review, review |
| Page polish | 1 | review |
| Review rules and build log | 0 | none |
| Confirm the Solana memo | 0 | none |
| Split the page | 1 | real page |
| Static first screen | 1 | test |
| Move to Astro | 3 | review, test, real page |
| Result page | 1 | real page |
| Fix the Node version | 0 | none |
| Match the main site | 2 | test, test |
| Score after the fix files | 1 | review |
| First screen rebuild | 4 | real page, test, real page, test |
| Readable record | 2 | test, test |
| Footer layout | 1 | real page |
| Pull request reviewer | 1 | review |
| Headline and page wording | 1 | review |
| Example pages | 5 | review, test, test, real page, review |
| Reviewer on large pull requests | 1 | review |
| Share and search tags | 2 | real page, test |
| Short reviews | 1 | review |
| Repos with a large history | 1 | review |
| Web2 and Web3 example groups | 3 | review, real page, review |
| One next step | 1 | review |
| Group the server folders | 0 | none |
| Message for a slow copy | 0 | none |
| Message for a slow check | 0 | none |
| Who approves a pull request | 0 | none |
| Make the Proof section clear | 0 | none |
| An About page for doctor | 0 | none |
| An agent view | 0 | none |
| A floating view switch | 0 | none |
| Correct the build note | 0 | none |
| Deploy the server on merge | 1 | review |
| Split the styles | 0 | none |
| New home page | 1 | review |
| Natural English server messages | 0 | none |
| New result page | 1 | review |
| About, agent view and share image | 1 | review |
| Correct the reachable score | 1 | test |
| Record matches the result | 2 | test, review |
| Save the examples again | 1 | review |
| Shorter copy | 2 | test, review |
| Next step and Verify | 3 | test, review, review |
| Review gate for auto-merge | 1 | review |
| One set of control states | 2 | real page, real page |

64 rounds over 51 tasks: a mean of 1.3. Found by review 29, tests 20, the commit check 2, real runs 13.

Four of the problems no test could have caught: a deploy that left out modules, a page buried by 26 repeated warnings, a wrong import, and a worker that weakened a security test while editing nearby lines.

This is one small project. These numbers show how this work went. They are not a benchmark.

Add one row for each new task.
