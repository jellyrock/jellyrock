// scripts/lint/skill-placeholders-check.js: rejects argument placeholders in skills.
//
// WHY THIS EXISTS
// ---------------
// Claude Code replaces `$ARGUMENTS`, `$ARGUMENTS[N]`, `$0` to `$9` and any name an
// `arguments:` frontmatter list declares, anywhere in a skill body, code spans and
// fences included, with no escape. A positional form breaks once a run passes enough
// arguments: `awk '{print $3}'` becomes `awk '{print delta}'` with four arguments.
// `$ARGUMENTS` gains nothing either: with no placeholder in the skill, Claude Code
// appends the arguments as a last line, `ARGUMENTS: <input>`.
//
// WHAT IT CHECKS
// --------------
// Each `.claude/skills/<name>/SKILL.md`, line by line, for `$ARGUMENTS`, a `$` before a
// digit, or a line that starts with `arguments:`. With no file arguments it reads every
// tracked skill; lint-staged passes the staged ones. Fix a hit by writing "the
// arguments" in prose, an awk field as `$ 3` (gawk and mawk read it as field 3), and
// money without a `$` before a digit.
//
// Only Node stdlib, so no npm ci needed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLACEHOLDER = /\$(ARGUMENTS|[0-9])|^arguments:/;
export const SKILL_FILE = /^\.claude\/skills\/.+\/SKILL\.md$/;

export function findHits(text, file) {
  return text
    .split('\n')
    .flatMap((line, i) => (PLACEHOLDER.test(line) ? [{ file, line: i + 1, text: line }] : []));
}

// Repo-relative POSIX paths, so an absolute path from lint-staged matches SKILL_FILE.
export function skillFiles(args, root) {
  const files = args.length
    ? args.map((f) => path.relative(root, path.resolve(root, f)).split(path.sep).join('/'))
    : execFileSync('git', ['ls-files', '-z', '--', '.claude/skills'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean);
  return files.filter((f) => SKILL_FILE.test(f));
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  const files = skillFiles(args, root);
  const hits = files.flatMap((f) => findHits(readFileSync(path.join(root, f), 'utf8'), f));
  if (hits.length === 0) {
    console.log(`skill-placeholders: no argument placeholders in ${files.length} skill(s) ✓`);
    return 0;
  }
  console.error('skill-placeholders: argument placeholders in skills:');
  for (const h of hits) console.error(`  ${h.file}:${h.line}: ${h.text.trim()}`);
  console.error(
    '\nWhy this blocks: Claude Code replaces these at run time, code included, with no escape. ' +
      'Write "the arguments" in prose (Claude Code appends them as a last line), an awk field ' +
      'as `$ 3`, and declare no `arguments:` list.',
  );
  return 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(main());
