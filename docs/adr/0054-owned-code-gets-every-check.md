# ADR 0054: Code kept in the repo gets every check; only package-managed code is exempt

**Status:** Accepted
**Date:** 2026-11-05

**related-files**: `components/websocket/README.md`, `bsconfig-base.json`, `scripts/bsc-plugins/dead-code.cjs`, `scripts/bsc-plugins/field-observer-wiring.cjs`, `scripts/bsc-plugins/no-raw-run.cjs`, `scripts/lib/lint-excludes.cjs`, `docs/architecture/build-and-tooling.md`

JellyRock has two kinds of third-party code. Package-managed code (the `roku_modules` folders that ropm writes) is regenerated on every install, so nobody edits it, and every check skips it. Code kept in the repo is ours whatever its origin, and every check applies to it: the type checker, bslint, the formatting checks, the convention plugins and the prose checks. Its origin is recorded in a `LICENSE` and a `README.md` beside it (upstream, pinned commit, local changes), not in a folder that switches checks off. The third-party `LICENSE` text is the only exemption, and it needs no rule because no check reads it. A finding in adopted code is fixed in the code or suppressed on its line with the reason, like any other code. Folders are named for what the code does (`components/websocket/`, `source/logging/`), not for where it came from.

The old `components/vendor/` folder was skipped by about ten checks while its README said JellyRock owned and linted the code. Adopting roku-log showed the cost: under that folder, nothing flagged an observer callback that no longer matched its function, which would have stopped every log line in dev builds without an error. In a normal folder, the `dead-code` check reported it. Moving `BrightWebSocket` out cost 8 findings: 7 unused byte helpers, deleted, and the Task's self-start, suppressed on its line.

**Ruled out:** a separate repo or our own npm package for adopted libraries. JellyRock is the only consumer, every fix would need two PRs and a release, and the roku-log hook came from ropm packaging in the first place (rokucommunity/ropm#69, rokucommunity/brighterscript#809). Also ruled out: keeping `vendor/` as a folder name for provenance only, since the name invites the exemptions back.
