// scripts/lib/signal-staleness.cjs: the PURE "does this signal row need human
// attention?" decision, extracted from scripts/catchup-state.js so it can be unit
// tested directly (the aggregator runs all its work at module top-level, so it
// can't be imported side-effect-free). The IO that feeds `ctx` (the live open-
// digest query) stays in catchup-state.js.

// The slug whose staleness is digest-driven rather than a version string compare.
const STABLE_SLUG = 'jellyfin-server-stable';

// Rows whose upstream version scripts/catchup-state.js fetches on every run and
// holds in memory only. Their file rows carry no `latest_upstream`; every other
// row is hand-managed and keeps it.
const AUTO_MANAGED_SIGNAL_SLUGS = new Set([STABLE_SLUG, 'jellyfin-server-rc', 'roku-os']);

// Stale = the row needs human attention.
//
// For most rows that's the close-loop string compare: upstream moved past the
// `latest_acknowledged` the user bumps via `/done <slug>` (placeholders like
// "(no RC in flight)" equal themselves and don't fire).
//
// `jellyfin-server-stable` is the exception. The server-upgrade tracker
// auto-closes the digest for a mechanically-clean release WITHOUT bumping
// `latest_acknowledged` (CI never writes the journals), so the string compare
// false-fires forever after every clean release. The TRUE "needs attention"
// signal for that row is an OPEN tracker digest: only a candidate-bearing
// release leaves one open; clean ones close themselves. `ctx.stableDigest` is:
//   - an object:  an open digest exists, so stale
//   - null:       no open digest, so not stale
//   - undefined:  not queried (offline / --no-gh), so fall back to string compare
function signalStaleness(row, ctx = {}) {
  if (row.status !== 'watching') return false;
  if (row.slug === STABLE_SLUG && ctx.stableDigest !== undefined) {
    return ctx.stableDigest !== null;
  }
  if (!row.latest_upstream || !row.latest_acknowledged) return false;
  return row.latest_upstream !== row.latest_acknowledged;
}

module.exports = { signalStaleness, STABLE_SLUG, AUTO_MANAGED_SIGNAL_SLUGS };
