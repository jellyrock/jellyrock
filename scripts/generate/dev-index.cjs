// Auto-generates the docs/dev/ index table inside docs/architecture/README.md.
//
// Why this exists: Phase 1 of the agent-context-system work dropped a
// 15-row hand-maintained "Existing dev guides" table from the architecture
// README because it was a maintenance trap — every new how-to required
// updating an index that wasn't enforced by anything. Now that every dev
// doc has YAML frontmatter (topic, related-files, last-reviewed) the index
// can be generated mechanically and stay forever-current.
//
// What it does:
//   - Walks docs/dev/*.md
//   - Extracts the first H1 heading as the human-readable title (frontmatter
//     `topic` is a slug; the H1 is what readers see)
//   - Builds a markdown table of (filename → title) sorted alphabetically
//   - Writes that table into docs/architecture/README.md between the
//     <!-- BEGIN/END auto-generated dev-index --> sentinel comments
//
// Run modes:
//   node scripts/generate/dev-index.cjs           → write (default)
//   node scripts/generate/dev-index.cjs --check   → fail if drift exists
//                                                   (no write; for CI)
//
// npm scripts:
//   docs:dev-index        → regenerate (write mode)
//   docs:dev-index:check  → drift check (used by pre-push hook)
//
// Pre-push hook integration: when docs/dev/*.md changes, the hook runs
// the regen step in auto-fix mode. Drift never lands.

'use strict';

const fs = require('fs');
const path = require('path');

// Argv parsing: any non-flag positional is treated as the root dir. Mirrors
// the pattern used by docs-stale.cjs so the two scripts behave the same way.
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));

const ROOT_DIR = positional[0] || '.';
const DEV_DIR = path.join(ROOT_DIR, 'docs/dev');
const README_PATH = path.join(ROOT_DIR, 'docs/architecture/README.md');
const CHECK_MODE = args.includes('--check');

const BEGIN_MARKER =
  '<!-- BEGIN auto-generated dev-index (run `npm run docs:dev-index` to regenerate) -->';
const END_MARKER = '<!-- END auto-generated dev-index -->';

// ────────────────────────────────────────────────────────────────────

function extractFirstH1(content) {
  // Skip frontmatter
  const fmEnd = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const body = fmEnd ? content.slice(fmEnd[0].length) : content;
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function buildIndex() {
  if (!fs.existsSync(DEV_DIR)) {
    throw new Error(`docs/dev/ not found at ${DEV_DIR}`);
  }
  const files = fs
    .readdirSync(DEV_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const rows = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(DEV_DIR, file), 'utf8');
    const title = extractFirstH1(content);
    if (!title) {
      throw new Error(`docs/dev/${file} has no H1 heading; cannot index`);
    }
    rows.push({ file, title });
  }

  const lines = [
    BEGIN_MARKER,
    '',
    '| File | Topic |',
    '|---|---|',
    ...rows.map((r) => `| [\`docs/dev/${r.file}\`](../dev/${r.file}) | ${r.title} |`),
    '',
    END_MARKER,
  ];
  return lines.join('\n');
}

function applyIndex(readmeContent, generatedBlock) {
  const beginIdx = readmeContent.indexOf(BEGIN_MARKER);
  const endIdx = readmeContent.indexOf(END_MARKER);

  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `README is missing the auto-gen sentinel comments; expected:\n${BEGIN_MARKER}\n…\n${END_MARKER}`,
    );
  }
  if (beginIdx > endIdx) {
    throw new Error('README sentinel comments appear in wrong order (BEGIN after END)');
  }

  const before = readmeContent.slice(0, beginIdx);
  const after = readmeContent.slice(endIdx + END_MARKER.length);
  return before + generatedBlock + after;
}

// ────────────────────────────────────────────────────────────────────

const generated = buildIndex();
const readme = fs.readFileSync(README_PATH, 'utf8');
const updated = applyIndex(readme, generated);

if (readme === updated) {
  console.log(`docs:dev-index: README already matches generated index (no changes).`);
  process.exit(0);
}

if (CHECK_MODE) {
  console.error(`docs:dev-index drift detected. Run 'npm run docs:dev-index' to regenerate.\n`);
  // Print a small diff hint
  const oldBlock = readme.slice(
    readme.indexOf(BEGIN_MARKER),
    readme.indexOf(END_MARKER) + END_MARKER.length,
  );
  const newBlock = generated;
  console.error('--- README (current)\n+++ generated (expected)\n');
  console.error(
    oldBlock
      .split('\n')
      .map((l) => `- ${l}`)
      .join('\n'),
  );
  console.error('');
  console.error(
    newBlock
      .split('\n')
      .map((l) => `+ ${l}`)
      .join('\n'),
  );
  process.exit(1);
}

fs.writeFileSync(README_PATH, updated, 'utf8');
console.log(`docs:dev-index: regenerated (${(generated.match(/\n\| \[/g) || []).length} entries).`);
process.exit(0);
