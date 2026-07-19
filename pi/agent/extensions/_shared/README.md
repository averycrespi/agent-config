# \_shared

Shared helpers for Pi extensions in this repository.

This directory is intentionally loader-inert: do not add an `index.ts` or `package.json`. Sibling extensions import individual modules directly, for example `../_shared/render.ts`, and Pi's extension loader skips this directory because it has no extension entrypoint.

Keep shared conventions aligned with the repo's Pi extension guidance in `AGENTS.md`.

## Modules

- `config.ts` — reads Pi settings files, extracts `extension:<name>` settings, merges defaults/global/project/environment config, parses boolean environment overrides, and registers masked `/EXTENSION-NAME-config` inspection commands.
- `logging.ts` — creates managed temp logs under `${tmpdir()}/pi-extension-logs/<extensionName>/`, with sanitized unique filenames and explicit deletion support.
- `render.ts` — compact rendering utilities for tool calls/results, including elapsed partial timers, width-aware truncated text, path labels, command labels, and common text extraction helpers.
- `retained-artifacts.ts` — securely stages, gzip-compresses, finalizes, ages, and quota-manages retained subagent failure logs and abnormal workflow recovery envelopes in one diagnostic pool.
- `spillover.ts` — large-output spill-to-file helper. It joins text blocks, writes oversized text to an owner-controlled temp directory, returns a preview envelope that references the full file, preserves image blocks inline, and falls back to original content on write failure.
- `untrusted.ts` — wraps external text and mixed text/image blocks in explicit untrusted-content boundaries while escaping delimiter-like lines from the external payload.

## Retained diagnostics

`retained-artifacts.ts` owns `${tmpdir()}/pi-retained-diagnostics` for exactly two finalized artifact classes: subagent `.log.gz` files and workflow recovery `.json.gz` files. The root must be a real current-user-owned directory and is hardened to mode `0700`. Gzip staging and final files use exclusive mode `0600` creation. Staging names are not finalization or eviction candidates; complete files are published without overwrite by same-directory hard link while a current-user-owned cross-process lock serializes cleanup, quota reservation, and publication.

Finalized compressed artifacts share a fixed 1 GiB quota measured in on-disk compressed bytes. Each artifact operation lazily removes recognized finalized files older than seven days, then evicts the oldest recognized finalized files until the new file fits. A single oversized file, lock contention, failed required eviction, unsafe root, compression/storage error, or inability to remain within quota discards the new diagnostic and returns a bounded warning. Active staging, live-process staging, symlinks, directories, and unrelated files are not quota/eviction candidates. Old staging from a demonstrably dead process is eligible for lazy removal only after seven days.

These files are sensitive. Gzip is compression, not sanitization or encryption. The helper never previews contents or sends them to a provider. Callers expose only finalized paths and bounded metadata. Generic spillover, workflow source-script copies, statusline/MCP logs, and other `logging.ts` consumers remain outside this pool. During migration, recognized legacy raw subagent `.log` files are eligible only for the same seven-day lazy age cleanup and never count toward the compressed quota.

## Spillover behavior

`spillover.ts` uses these defaults:

- `THRESHOLD_CHARS = 25_000`
- `PREVIEW_BYTES = 2_000`
- `SPILL_DIR = join(tmpdir(), "pi-extension-spillover")`

When joined text content exceeds the threshold, the helper requires `<SPILL_DIR>` to be a real directory owned by the current user, sets its mode to `0700`, and writes the full joined text to `<SPILL_DIR>/<toolCallId>.txt` with exclusive creation and mode `0600`. Returned content replaces text blocks with a single `<persisted-output>` envelope at the first text-block position; non-text blocks such as images are preserved. If directory validation, permission hardening, or writing fails, the original content is returned unchanged.
