# crash-backtrace — audit log

## 2026-05-22 — dashboard-TSV input handled in helper, not SKILL.md (session 7c918dec)

**Friction surfaced:** none from the mechanical detectors. Zero `findings`. The cost was hidden in the opening thinking block — ~5K-char self-narration deriving the dashboard TSV-with-`~~`-separators shape and a manual conversion to plaintext.

**Performance:** 1m 24s, 33,836 output tokens, 0.69 cache hit, ~$1.72 (sonnet 4.6). Anomaly: avg 1253 output tokens/turn — high for a procedural skill (target <500). Driven almost entirely by the dashboard-format reasoning at turn 1; the rest of the run was clean tool-driven mechanics.

**Permission gaps:** none — all bash invocations covered by the skill's `allowed-tools` allowlist.

**Output accuracy (eyeball):** accepted on first try. Two enrichments succeeded (#582 FontDownloadTask, #584 captionTask), one correctly skipped (QuickConnectEnabledTask — no matching `[crash]` issue), and the user-facing summary cited each issue with a clickable comment URL.

**Model fit:** current `model: sonnet` — keep. Profile is mechanical-with-judgment-seams (auto-resolve / classification / no-match branches carry real decisions); downgrade to haiku is tempting but premature on a single audit.

**Root cause:** the SKILL.md described only the cleaned plaintext-backtrace shape, but the user's actual paste is the dashboard's "Daily Error Key" TSV (header row + N data rows, `~~` separator inside the `Backtrace Text Formatted` cell). `scripts/crash-report.js` already exposes `parseBacktraceCell` and `parseDashboardCsv`, but the single-issue subcommands (`enrich-issue` / `classify-backtrace` / `resolve-issue`) only wired up `normalizeBacktraceText`, which assumed plaintext. The agent ate the reasoning tax to bridge the gap.

**Fixes applied:**
- `scripts/crash-report.js:1239-1271` — `normalizeBacktraceText` now auto-detects dashboard TSV via `validateDashboardCsv` header sniff and returns the first data row's `Backtrace Text Formatted` cell. Plaintext and already-normalized cell shapes still flow through the existing path. All three subcommands (`enrich-issue` / `classify-backtrace` / `resolve-issue`) benefit automatically — single seam.
- `tests/scripts/unit/crash-report.test.js:666-684` — three new Vitest cases covering the dashboard-TSV-direct branch (round-trips through `parseBacktraceCell`, errors on header-only input, errors on empty data cell). 123/123 pass.
- `.claude/skills/crash-backtrace/SKILL.md` — replaced the single-shape backtrace example block with a three-shape block ("plaintext / dashboard TSV / already-normalized cell") pointing at the helper's responsibility. Trimmed Step 1's `@file` bullet to "pass the path through — no Read, no reformatting." Subsumed Step 2's belt-and-suspenders regex check into Step 3 (`classify-backtrace` is the cheap pre-check; redundant skill-side regex would have to know all three shapes, defeating the architectural fix).

**Deferred / dropped:**
- Heredoc-vs-Write tool nit (Proposal 3) folded into the Step 1 trim above — Step 1 now explicitly says "use the `Write` tool" for inline paste.
- `/log decision` not invoked — the change modifies an existing helper rather than adding a new one, no model change, no hook change, no load-bearing-rule change. Stays in this AUDIT-LOG.md per Step 6a.

**Source transcript:** `~/.claude/projects/-home-charlie-PROJECTS-JellyRock-jellyrock3/7c918dec-b9b4-4407-9f6c-c56b542fa146.jsonl`