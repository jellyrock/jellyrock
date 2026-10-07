// scripts/docs-fact-report.js: what a docs rewrite removed or added, fact by fact.
//
// A voice rewrite (docs/dev/writing-style.md) changes nearly every line of a doc, so
// a line diff cannot show whether a fact was lost along the way. This report compares
// each changed markdown file at the base with the working tree and lists the facts
// whose count changed:
//   - numbers (versions, measurements, counts, times);
//   - inline code spans (symbols, commands, paths, settings keys);
//   - link targets.
// A reviewer checks each removed fact still holds somewhere or was meant to go, and
// each added one is true. It reports and never fails: judging a fact needs a person.
//
// Usage: npm run docs:fact-report [-- --base <ref>] [--json]
//   --base  the ref to compare against (default `main`); the merge base with HEAD is
//           used, so commits that landed on the base since branching are not counted.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { git } = require('./lib/git-safe.cjs');

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');
const baseIdx = args.indexOf('--base');
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : 'main';
const CWD = process.cwd();

// Generated or local-only markdown: no reviewer reads a rewrite of these.
const EXCLUDED = (rel) => rel === 'CHANGELOG.md' || rel.startsWith('docs/projects/');

/** Each fact kind as `kind -> Map(fact -> count)` for one markdown text. */
export function extractFacts(text) {
  const facts = { number: new Map(), code: new Map(), link: new Map() };
  const add = (kind, value) => facts[kind].set(value, (facts[kind].get(value) ?? 0) + 1);

  for (const m of text.matchAll(/`([^`\n]+)`/g)) add('code', m[1]);
  for (const m of text.matchAll(/\]\(([^)\s]+)[^)]*\)/g)) add('link', m[1]);
  for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) add('link', m[1]);
  for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) add('link', m[1]);

  // Numbers from the prose only, so a number inside a code span or a link is not
  // counted twice.
  const prose = text
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<https?:\/\/[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  for (const m of prose.matchAll(/\d+(?:[.,:]\d+)*%?/g)) add('number', m[0]);
  return facts;
}

/** `{ removed: [{kind, fact, before, after}], added: [...] }` between two texts. */
export function diffFacts(before, after) {
  const a = extractFacts(before);
  const b = extractFacts(after);
  const removed = [];
  const added = [];
  for (const kind of Object.keys(a)) {
    for (const fact of new Set([...a[kind].keys(), ...b[kind].keys()])) {
      const was = a[kind].get(fact) ?? 0;
      const now = b[kind].get(fact) ?? 0;
      if (now < was) removed.push({ kind, fact, before: was, after: now });
      else if (now > was) added.push({ kind, fact, before: was, after: now });
    }
  }
  return { removed, added };
}

function changedDocs(base) {
  const mergeBase = git(CWD, ['merge-base', base, 'HEAD']).trim();
  const out = git(CWD, ['diff', '--name-status', '-M', mergeBase, '--', '*.md']);
  const docs = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    const oldPath = paths[0];
    const newPath = paths[paths.length - 1];
    if (EXCLUDED(newPath)) continue;
    // A new file has no earlier facts to lose; its content is reviewed as a whole.
    if (status.startsWith('A')) continue;
    const before = git(CWD, ['show', `${mergeBase}:${oldPath}`]);
    const afterPath = path.join(CWD, newPath);
    const after =
      status.startsWith('D') || !fs.existsSync(afterPath) ? '' : fs.readFileSync(afterPath, 'utf8');
    docs.push({
      file: newPath,
      from: oldPath !== newPath ? oldPath : undefined,
      deleted: !after,
      ...diffFacts(before, after),
    });
  }
  return docs;
}

function render(docs) {
  const fmt = (f) => {
    const count = f.before > 1 || f.after > 1 ? ` (${f.before} → ${f.after})` : '';
    return `- ${f.kind} \`${f.fact.replace(/`/g, "'")}\`${count}`;
  };
  const changed = docs.filter((d) => d.removed.length || d.added.length);
  const lines = [`## Fact report against \`${BASE}\``, ''];
  lines.push(
    changed.length
      ? `${changed.length} of ${docs.length} changed doc(s) lost or gained a number, code span or link.`
      : `No facts changed in ${docs.length} changed doc(s).`,
  );
  for (const d of changed) {
    lines.push(
      '',
      `### ${d.file}${d.from ? ` (was ${d.from})` : ''}${d.deleted ? ' (deleted)' : ''}`,
    );
    if (d.removed.length) {
      lines.push('', 'Removed: check each still holds elsewhere, or was meant to go.', '');
      lines.push(...d.removed.map(fmt));
    }
    if (d.added.length) {
      lines.push('', 'Added: check each is true.', '');
      lines.push(...d.added.map(fmt));
    }
  }
  return lines.join('\n') + '\n';
}

// Run only as a CLI, so the tests can import the pure functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let docs;
  try {
    docs = changedDocs(BASE);
  } catch (e) {
    console.error(`docs-fact-report: cannot compare against \`${BASE}\`: ${e.message.trim()}`);
    process.exit(1);
  }
  process.stdout.write(JSON_MODE ? JSON.stringify(docs) + '\n' : render(docs));
}
