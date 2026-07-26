---
name: golang
description: Use when writing, modifying, debugging, planning, or reviewing Go code, including .go files and Go modules. Provides guidance for idiomatic standard-library-first implementations and focused abstractions.
---

# Go

Apply these conventions when working with Go code:

- Prefer simple, idiomatic Go using the standard library before writing custom helpers or adding dependencies.
- Before implementing parsing, collection helpers, sorting, filesystem/path handling, HTTP behavior, JSON encoding/decoding, error wrapping, time handling, synchronization, hashing, or string/byte manipulation, check whether the Go standard library already provides the needed behavior.
- Do not add generic helpers such as `contains`, `min`, `max`, set types, path normalizers, retry loops, JSON wrappers, or HTTP abstractions unless they are clearly simpler than direct standard-library usage or the repository already has an established helper.
- When a custom implementation is still necessary, keep it narrow and be prepared to explain why standard-library behavior is insufficient.
- During review, flag homegrown code that duplicates clear standard-library functionality.
