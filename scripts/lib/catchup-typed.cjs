// scripts/lib/catchup-typed.cjs — the banner rules of .claude/skills/catchup/jellyrock.md
// as the typed lines the shared reader (.claude/skills/catchup/catchup-state.sh) ranks;
// its header defines the line types. Pure, so it is unit tested directly: catchup-state.js
// prints these before its JSON under --typed. Each BANNER id's class is in
// .claude/skills/catchup/catchup.conf, and a test keeps BANNER_IDS and that file in step.
// Fields are tab-separated, so a field never carries a tab or newline; a line of two
// leading spaces is a detail of the line above.

const BANNER_IDS = [
  'ci-failing',
  'handoff-pending',
  'signals-stale',
  'review-requested',
  'signals-action-pending',
];

// A finished run with any other conclusion did not pass (failure, cancelled, timed_out,
// startup_failure, action_required, ...). A run still in progress has no verdict yet.
const NOT_FAILING = new Set(['success', 'skipped', 'neutral']);

const field = (value) =>
  String(value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
const banner = (id, text, route = '') => `BANNER\t${id}\t${field(text)}\t${field(route)}`;
const note = (kind, id, text) => `${kind}\t${id}\t${field(text)}`;
const section = (state, key) => (state[key] && typeof state[key] === 'object' ? state[key] : null);

function ciLines(runs) {
  // gh run list is newest first: a run is recovered by a green run of the same workflow
  // listed before it
  return runs.flatMap((r, i) => {
    if (r.status !== 'completed' || NOT_FAILING.has(r.conclusion)) return [];
    const what = `CI run "${r.name}" ${r.conclusion} (${r.createdAt})`;
    const recovered = runs.slice(0, i).some((n) => n.name === r.name && n.conclusion === 'success');
    if (recovered) return [note('INFO', 'ci-recovered', `${what}, recovered by a later green run`)];
    return [banner('ci-failing', what, `/ci-triage ${r.databaseId ?? '<run-id>'}`)];
  });
}

function signalLines(signals) {
  const rows = Array.isArray(signals.rows) ? signals.rows : [];
  const out = rows
    .filter((r) => r.stale)
    .map((r) => {
      const digest = r.digest ? `; open digest #${r.digest.number}` : '';
      const text = `signals-backlog: ${r.slug} needs attention (upstream ${r.latest_upstream}, acknowledged ${r.latest_acknowledged}${digest})`;
      return banner(
        'signals-stale',
        text,
        r.digest ? '/server-upgrade' : `review the upstream change, then /done ${r.slug}`,
      );
    });
  const pending = rows.filter((r) => r.status === 'action_pending').map((r) => r.slug);
  if (pending.length > 0) {
    out.push(
      banner(
        'signals-action-pending',
        `${pending.length} signal(s) in action_pending (${pending.join(', ')}): these need a JellyRock change`,
      ),
    );
  }
  return out;
}

function typedLines(state) {
  const out = [];
  for (const [name, error] of Object.entries(state._errors ?? {})) {
    out.push(note('ERROR', name, `catchup-state: ${name} failed: ${error}`));
    if (name === 'signals')
      out.push(`  ${field('fix docs/signals-backlog.md, then npm run lint:docs')}`);
  }

  const ci = section(state, 'ci');
  if (ci && Array.isArray(ci.current_branch_runs)) out.push(...ciLines(ci.current_branch_runs));

  const signals = section(state, 'signals');
  if (signals) out.push(...signalLines(signals));

  const prs = section(state, 'prs');
  for (const pr of prs?.review_requested ?? []) {
    out.push(
      banner(
        'review-requested',
        `PR #${pr.number} awaiting your review: ${pr.title}`,
        `/code-review ${pr.number}`,
      ),
    );
  }

  const stale = section(state, 'docs_stale')?.architecture ?? [];
  if (stale.length > 0) {
    const list = stale
      .map((d) => `${d.file} (${d.days == null ? 'no date' : `${d.days}d`})`)
      .join(', ');
    out.push(
      note(
        'INFO',
        'arch-docs-stale',
        `${stale.length} architecture doc(s) stale: ${list} (info only; the blocking gate is CI's)`,
      ),
    );
  }

  for (const h of section(state, 'handoffs')?.pending ?? []) {
    out.push(
      banner(
        'handoff-pending',
        `pending handoff .claude/handoffs/${h.name} (${h.age_days}d old)`,
        'read it and follow the skill that wrote it',
      ),
    );
  }
  return out;
}

module.exports = { typedLines, BANNER_IDS };
