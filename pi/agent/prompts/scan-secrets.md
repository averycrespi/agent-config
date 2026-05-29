---
description: Fast scan branch or unpushed commits for secrets
---

Perform a fast read-only leak scan for the current git repository. Do not edit, stage, commit, push, fetch, or rewrite history.

1. Identify repo root, current branch, and `git status --short`.
2. Choose a base ref: prefer `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`, then upstream for the current branch. Scan `BASE..HEAD` plus staged, unstaged, and relevant untracked files.
3. If `gitleaks` is installed, run it with redaction over the commit range and changed working-tree content. Do not install tools.
4. If `gitleaks` is unavailable or incomplete, use targeted `rg`/`git diff` checks over changed and untracked text files for obvious secrets: API keys, tokens, private keys, passwords, cookies, database URLs, cloud credentials, `.env` assignments, high-entropy blobs, and private URLs.
5. Inspect only scanner hits and suspicious changed files such as `.env`, config files, logs, dumps, archives, certificates, keys, notebooks, screenshots, and modified ignore rules.

Report:

- scope scanned
- commands run
- `OK`, `REVIEW`, or `BLOCKER`
- findings with file path/line or diff context, redacting secret values
- limitations

If any `BLOCKER` is found, clearly say not to merge or push until it is removed and, if already exposed beyond the local machine, rotated/revoked.
