# ADR 0007: Server-upgrade join diffs committed spec fingerprints, never a live fetch

**Status:** Accepted
**Date:** 2026-05-29

**related-files**: scripts/generate/findings-candidates.js, scripts/generate/spec-fingerprint.js, scripts/generate/spec-diff.js, docs/architecture/spec-fingerprints/, docs/architecture/server-upgrade-automation.md

The server-upgrade-automation join step (`findings-candidates.js`, Phase 2) computes its forward delta from **committed spec fingerprints** read off disk, not from a spec fetched live at run time. "Fetch latest + commit its fingerprint" stays a separate, explicit step (`spec-fingerprint.js <version>`) that the release trigger runs once; the join itself never touches the network. We considered fetch-latest-on-demand (the join fetches the newest spec and diffs against it in one shot) and ruled it out: it would make the deterministic core network-dependent and non-reproducible — two runs against the same `<from>`/`<to>` could disagree if the upstream spec were re-published — which is at odds with the pipeline's stated deterministic/cacheable/offline principle and would make the whole join impossible to fixture-test.

The cost of the chosen path is that acting on a brand-new release is a two-step trigger (`spec-fingerprint.js <latest>` then `api-watch:findings <ack> <latest>`) rather than one. That's acceptable because committing the latest fingerprint is a natural, reviewable part of acknowledging a release anyway, and the fingerprints are small reduced-surface JSON (descriptions/examples stripped), so they're diffable in review without the ~2 MB raw-spec bloat. Pairs with the committed-fingerprints-over-raw-specs artifact decision recorded in the design doc's Decisions section.
