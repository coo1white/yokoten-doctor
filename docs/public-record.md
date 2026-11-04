# Public record

What is recorded.
A SHA-256 hash of the result is recorded.
The repo, the commit, the yokoten version and the time are also recorded.
No file contents are recorded.
Only public repos are checked, so only public repos are recorded.
There is one record for each repo, commit and yokoten version.

How to check a record.
Download the result from the page.
Run `sha256sum` on it.
Open the Rekor entry and compare the hash.
Open the Solana memo and compare the hash.

Review reports.
A review report gets its own record when the server can write one.
That record holds the SHA-256 hash of the report.
It also names the repo, the commit, the cool-workflow version and the hash of the check the report came from.
The report holds the hash of its whole run file.

How to check a review report.
Download the report record from the report page.
Run `sha256sum` on it, and compare the hash with the Rekor entry and the Solana memo.
Download the run file from the report page.
Run the `cw report verify-bundle` command that the page shows.
It proves the run did not change after the review.
It does not prove the AI is right.

Who signed it.
The Rekor entries are signed with this public key:
```
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEv0r+aFPqK5dpXDY7YFcYxrjbJGAU
7uYN++yltBw4UbETGnrjJjfwbv5JuDekJLsj33bcSuIkgDtoSQ9/M5y0Ag==
-----END PUBLIC KEY-----
```
The Solana memos are sent by the devnet address `4MXB78yjboUTWhQHVcnnTbT5FXBkQzHy6NptVWhT8x76`.

What a record proves and what it does not.
It proves that this server held this result at that time.
It proves that the result has not changed since.
It does not prove the server ran yokoten honestly.
For that, re-run the commands on the page.

About Solana devnet.
Solana devnet is a test network.
It can be reset, so its records may disappear.
Rekor is the lasting record.
The devnet coins have no value, and this code cannot reach mainnet.
