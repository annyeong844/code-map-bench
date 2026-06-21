---
name: code-map
description: |
  Read the exact source of KNOWN symbols (functions, methods, classes) cheaply via the
  code-map `read` MCP tool instead of grep + sed/cat. Use PROACTIVELY when:
  (1) You already know a symbol's name, id, or file:line and need to see its body.
  (2) You need to read SEVERAL known symbols — batch them in one `read` call.
  (3) You are about to grep for a name and then sed/cat the matching lines to read a body
      (code-map returns that exact slice in one call — skip the grep+sed dance).
  Use your normal shell search ONLY to discover candidates whose name/location you don't
  know yet; once you know the names, switch to code-map read for the bodies.
---

# code-map: exact source slices for known symbols

`code-map` is an MCP server exposing one tool, `read`. It returns the RAW source slice of a
symbol (its own bytes — the function/method/class body), not the whole file, so it is far
cheaper than grep-then-read and never floods context with unrelated matches.

## Routing rules (when to use what)

- **Known symbol body → `read`.** If you know the name / id / `path#name`, call `read`. Do NOT
  read a known body with `grep`/`sed`/`cat`.
- **Several independent known symbols → ONE batch `read`.** Pass `refs: ["a", "b", "c"]` in a
  single call rather than one call per symbol (fewer round-trips, lower cost). Split only when
  a later read depends on an earlier result, or the batch exceeds 64 refs.
- **Unknown target → grep to DISCOVER, then `read`.** Use shell search only to find the
  name/line of something you can't yet name; once discovered, read its body with `read`.
- **Interpret the raw code**, not index metadata — `read` gives coordinates, you do the judging.

## How to call it

The tool is `read` on the `code-map` MCP server. Examples:

- one symbol:  `read({ ref: "dispatch_hook" })`  or  `read({ ref: "requests/hooks.py#dispatch_hook" })`
- several:     `read({ refs: ["get_connection", "dispatch_hook", "resolve_redirects"] })`

If a name is ambiguous it returns candidates; pick the right `path#name` and read that.
If the file drifted since indexing, `read` re-anchors on the signature and flags it.
