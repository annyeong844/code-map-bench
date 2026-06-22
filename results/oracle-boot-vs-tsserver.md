# code-oracle (tsgo) boot time & memory vs Node tsserver

- generatedAt: 2026-06-22
- platform: Windows (win32, native binaries)
- engines: code-oracle = `@typescript/native-preview` (tsgo, Go-native) · tsserver = `typescript` 6.0.3 (Node)
- metric: warmup = spawn -> first `references` answer; RSS = peak resident set (Windows `tasklist`)
- note: code-oracle is skill-gated (off by default; the skill fires it only for who-calls / definition / implementations on large TS). This records what it costs *when it fires*.

## Results

| repo | engine | RSS | warmup |
|---|---|---:|---:|
| code-map (small TS, ~240 symbols) | tsgo | 73 MB | 3.2 s |
|  | code-oracle full (tsgo + Node MCP host) | 130 MB | 3.2 s |
|  | tsserver (Node LSP) | 217 MB | 4.1 s |
| microsoft/TypeScript (large TS, `checker.ts` 3.1 MB) | tsgo | 351 MB | 7.8 s |
|  | code-oracle full | 417 MB | 7.8 s |
|  | tsserver (Node LSP) | 672 MB | 16.4 s |

## Takeaway

- The tsgo-based oracle **boots faster** than the Node tsserver — ~2x on the large repo (7.8 s vs 16.4 s).
- And it **uses less RAM** — the tsgo engine is ~1/3 (small repo) to ~1/2 (large repo) of tsserver; even code-oracle's full footprint (engine + MCP host) stays under tsserver alone.
- The footprint still scales with repo size (73 MB -> 351 MB), so the oracle stays skill-gated rather than always-on; the default `read` path keeps zero resident cost and pays this only when a reference query actually needs it.

## Method

Each engine was spawned on the same repo/file on Windows. Warmup is measured to the first cross-reference answer; peak RSS sampled via `tasklist`. tsserver is driven over its stdio command protocol (`open` + `references`); tsgo is driven via code-oracle's `callers`. Only the TS compiler's `src/` was checked out (no tests / node_modules), so both engines load the same compiler program.
