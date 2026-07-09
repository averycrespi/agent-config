---
name: playwright
description: "Reference skill for browser automation: web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages."
license: Complete terms in LICENSE
---

# Playwright

Use `playwright-cli` to drive a browser from snapshots. Prefer semantic element references from the latest snapshot over brittle selectors or coordinates.

## Basic workflow

1. Open the target.
2. Inspect the current snapshot.
3. Interact using element references such as `e3`.
4. Snapshot again after navigation or state changes.
5. Verify the requested outcome from page state, not just command success.
6. Close the browser when finished.

```bash
playwright-cli open https://example.com
playwright-cli snapshot
playwright-cli click e3
playwright-cli fill e5 "user@example.com"
playwright-cli snapshot
playwright-cli close
```

Snapshots are usually more useful than screenshots for interaction and verification. Take screenshots when the visual result itself is evidence or an artifact.

## Operating rules

- Use references from the newest snapshot; navigation and rerenders can invalidate old references.
- Prefer `fill` for form fields and `type` when keystroke behavior matters.
- Verify URLs, text, accessible state, controls, console output, or network activity appropriate to the task.
- Preserve user data and existing sessions. Do not clear cookies, storage, profiles, or persistent browser data unless requested or necessary and authorized.
- Use a named session when parallel work or isolation from the default session matters.
- Never submit purchases, publish content, send messages, or perform another externally visible action without authorization.
- Close sessions and stop traces or recordings created for the task.

## Sessions and installation

Use `-s=<name>` on every command for a named session:

```bash
playwright-cli -s=review open https://example.com
playwright-cli -s=review snapshot
playwright-cli -s=review close
```

Use persistent profiles only when the task requires state across browser restarts. If the global binary is unavailable, try `npx playwright-cli`.

When a command or option fails, inspect the installed CLI help instead of guessing:

```bash
playwright-cli --help
playwright-cli <command> --help
```

## Verification and evidence

For browser tests and investigations:

- capture the initial and final relevant state
- distinguish observed browser behavior from inference
- record console or network evidence only when it helps answer the task
- report blocked authentication, unavailable data, or destructive-action boundaries
- retain screenshots, traces, videos, or saved state only when they are requested deliverables or useful debugging evidence

## Task-specific references

Load only the reference needed for the task:

- [Request mocking](references/request-mocking.md)
- [Running Playwright code](references/running-code.md)
- [Browser session management](references/session-management.md)
- [Storage state](references/storage-state.md)
- [Test generation](references/test-generation.md)
- [Tracing](references/tracing.md)
- [Video recording](references/video-recording.md)
