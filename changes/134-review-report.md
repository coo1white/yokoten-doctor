Added

- After a check, you can ask for a review report: the risks an AI agent should know before it changes the project, each one linked to a line of code at the checked commit. cool-workflow plans the work, and Muse Spark Open reads the files. It runs no code from the project. You can download the whole report as Markdown.
- A review report gets its own public record when it can be written (Sigstore Rekor, a Solana devnet memo, or both), linked to the check's record. The page says when there is none or only part. It shows the report wasn't changed after it was made, not that it's right.
- You can download the whole review run (every task, every answer and its hash-chained log) and check it offline with one cool-workflow command. Its hash is in the report's record. Reports now use cool-workflow 0.4.1.
