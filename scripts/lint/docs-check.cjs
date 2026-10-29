// Validates references in the architecture docs against the actual repo.
// Catches drift between what docs say exists and what the code does.
//
// Why this exists: the architecture docs (docs/architecture/*.md) reference
// many source files in two ways:
//   1. YAML frontmatter `related-files:` lists, which power agent-context
//      discovery and serve as the doc's "this is what I'm about" claim.
//   2. Inline markdown links to other docs and source files.
//
// When source files get renamed, moved, or removed, these references go
// stale silently. Code review caught two such errors in the v2.15.0 doc
// refresh: Constants.xml at a wrong path, and OSD timeout misattributed
// to OSD.xml when the literal lives in VideoPlayerView.xml. This script
// would have caught both.
//
// What it checks:
//   - Every `related-files:` path in docs/architecture/*.md frontmatter
//     resolves to an existing file (or directory) in the repo.
//   - Every relative markdown link in the .md files under docs/architecture/,
//     docs/dev/, docs/user/ and docs/adr/ (subfolders included), and in
//     docs/decisions.md, resolves
//     (skipping http(s): and mailto:). A link with a `#fragment`, to another
//     .md file or to the same file (`#x`), must also name a heading or an
//     explicit anchor (`<a id>`, `<a name>`, `<hN id>`) that exists in the
//     target, using GitHub's slug rule (see headingToAnchor). Line anchors
//     such as `#L12` and `#L12-L20` are not checked. The same-file check
//     covers the CLAUDE.md files this script scans, which markdownlint MD051
//     does not lint. Files under .claude/ are not scanned.
//   - Every tech-debt anchor reference (anywhere in scanned files) of
//     the form `tech-debt.md#<anchor>` resolves to a real heading
//     anchor in docs/architecture/tech-debt.md. This is the canonical
//     form for citing a slug or section from outside; narrative-form
//     mentions (a backtick-wrapped kebab string in prose) are
//     intentionally not checked, because there's no syntactic signal to
//     distinguish them from any other backtick-wrapped kebab string in
//     the codebase (plugin names, npm scripts, etc.) without a fragile
//     proximity heuristic or a registry of false positives. The
//     anchor-link convention is documented in tech-debt.md's preamble.
//     Catches the failure mode where a slug gets removed from
//     tech-debt.md but anchor refs elsewhere go stale. Surfaced when 4
//     such refs slipped through the v2.15.0 doc audit.
//   - The docs/decisions.md supersede chain (see
//     checkDecisionsSupersedeChain): unique slugs, one value per
//     field, a valid `status` enum, every pointer resolves within the
//     file, both the full and the partial supersede pair are
//     symmetric, `superseded` records its successor, `withdrawn` is
//     terminal, and nothing points at itself. The supersede ritual is
//     a three-part hand edit, so a half-applied one used to leave the
//     chain silently lying, and `/log`'s SKILL.md claimed this was
//     already validated when no such logic existed.
//   - The Roku store descriptions in docs/admin/store-listing.md (see
//     checkStoreListing): each block is within the dashboard's limit,
//     and each count it cites (languages, themes, the oldest Jellyfin
//     server) matches its source, so a release never ships a stale
//     number. The text is pasted into the store by hand, where nothing
//     checks it.
//   - The frontmatter of each feature page in docs/user/features/ (see
//     checkFeaturePages): the fields a catalog of features is built from,
//     each checked against the app (its version, the server floor, the
//     plugins page, the screenshot list).
//
// What it doesn't check (yet):
//   - Inline backtick-quoted paths in prose (noise-prone; many false
//     positives for hypothetical/example paths).
//   - Function names referenced in prose (would require a BS-aware
//     parser; deferred to a possible BSC plugin).
//
// Exits 1 on any broken reference, 0 when clean.
//
// Flags:
//   --verbose  per-file counts on stdout
//   --json     emit a single JSON object on stdout: {filesChecked, errorsCount,
//              errors: [{category, file, message, target}]} where category is
//              one of "broken-related-file", "broken-link", "broken-anchor",
//              "stale-anchor", "progress-frontmatter",
//              "decisions-supersede-chain", "store-listing",
//              "readme-counts", or "feature-frontmatter".
//              Mutually exclusive with --verbose (verbose is a no-op under
//              --json). Exit code semantics unchanged.
//
// npm scripts:
//   lint:docs  runs this check

'use strict';

const fs = require('fs');
const path = require('path');
const { readFrontmatter, parseRelatedFiles, getLastUpdated } = require('../lib/frontmatter.cjs');
const {
  FEATURE_FIELDS,
  appFacts,
  appVersion,
  compareVersions,
  featurePageFiles,
  listedPlugins,
  parseFeaturePage,
  readServerFloor,
  screenshotKeys,
} = require('../lib/feature-facts.cjs');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');
const DEV_DIR = path.join(ROOT_DIR, 'docs/dev');
const USER_DIR = path.join(ROOT_DIR, 'docs/user');
const ADR_DIR = path.join(ROOT_DIR, 'docs/adr');
const DECISIONS_PATH = path.join(ROOT_DIR, 'docs/decisions.md');
const PROGRESS_PATH = path.join(ROOT_DIR, 'docs/progress.md');
const STORE_LISTING_PATH = path.join(ROOT_DIR, 'docs/admin/store-listing.md');
const FEATURES_DIR = path.join(USER_DIR, 'features');
const TECH_DEBT_PATH = path.join(ARCH_DIR, 'tech-debt.md');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const JSON_MODE = process.argv.includes('--json');
const VERBOSE = process.argv.includes('--verbose') && !JSON_MODE;

// NOTE: progress.md `last-updated` *temporal staleness* (too many days old) is
// not checked here, by design. That's a property of the shared journal on
// main, not of any one PR, so blocking a PR on it punished the wrong
// contributor. The staleness signal now lives non-blocking in
// scripts/lint/progress-cursor-nudge.cjs (Stop hook + pre-push) and
// .github/workflows/docs-stale-tracker.yml (weekly main-branch tracking issue).
// What DOES stay here is the *structural* frontmatter check below
// (checkProgressFrontmatter): a well-formed `last-updated` is a per-PR property.
// A PR that malforms it is at fault, and the tracker, /catchup, and
// journal-sync all read that field.

// docs/decisions.md note statuses, per that file's own Format section.
const DECISION_VALID_STATUSES = ['accepted', 'superseded', 'withdrawn'];

// ────────────────────────────────────────────────────────────────────
// Markdown link extraction: relative path links only.
// Skips: http(s)://, mailto:, and a bare `#`.
// Returns {target, fragment} where target is the path part (empty for a
// same-file `#x` link) and fragment is the text after the first `#` (empty
// when there is none).
// ────────────────────────────────────────────────────────────────────

function findMarkdownLinks(content) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1];
    if (raw.startsWith('http://') || raw.startsWith('https://')) continue;
    if (raw.startsWith('mailto:')) continue;
    const hash = raw.indexOf('#');
    const target = hash === -1 ? raw : raw.slice(0, hash);
    if (!target && !raw.slice(hash + 1)) continue;
    links.push({ target, fragment: hash === -1 ? '' : raw.slice(hash + 1) });
  }
  return links;
}

// ────────────────────────────────────────────────────────────────────
// Tech-debt anchor references: bulletproof check against a single
// canonical form: `tech-debt.md#<anchor>`. Validates that the anchor
// resolves to an actual heading in tech-debt.md.
//
// We don't try to detect narrative-style slug citations
// (for example "see `slug-name`") because there's no syntactic signal that
// disambiguates them from any other backtick-wrapped kebab-case
// identifier in the codebase (plugin names, npm scripts, module IDs).
// Any heuristic for that (proximity windows, registries of "known
// non-slug strings", etc.) is fragile and accumulates maintenance
// debt. The chosen design: declare anchor form canonical, document it
// in tech-debt.md, and validate it strictly.
// ────────────────────────────────────────────────────────────────────

// Reference form: any URL or path ending in `tech-debt.md#<anchor>`.
// The anchor capture is permissive (anything after the # up to a word
// boundary or markdown delimiter) so we catch both slug-style anchors
// (kebab-case) and section-heading anchors, which keep a double hyphen
// where the heading has punctuation between two spaces, and keep
// underscores.
const ANCHOR_REF_RE = /\btech-debt\.md#([a-z0-9][a-z0-9_-]*)(?=[)\s.,;'"`]|$)/gim;

// GitHub's line anchors (`#L12`, `#L12-L20`, `#L12C3-L14C5`) address lines in
// a file view, not headings, so they are never looked up among the anchors.
const LINE_ANCHOR_RE = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/;

// Explicit anchors: `<a id="x">`, `<a name="x">` and `<hN id="x">`.
const EXPLICIT_ANCHOR_RE = /<(?:a|h[1-6])\b[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

/**
 * Turn heading text into the anchor GitHub gives it (github-slugger's rule):
 * lowercase, drop every character that is not a letter, mark, number,
 * connector punctuation (which includes `_`), space or hyphen, then turn
 * each space into a hyphen. Spaces are not collapsed, so "a & b" becomes
 * "a--b". Inline markup is removed first because GitHub slugs the rendered
 * text: link syntax keeps its label, HTML tags go, and backticks and `*`
 * disappear while an underscore is kept. Repeated headings are numbered by
 * the caller (see extractAnchors).
 */
function headingToAnchor(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) -> label
    .replace(/<[^>]*>/g, '') // inline HTML tags
    .replace(/[`*]/g, '') // code span and emphasis markers
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Collect every anchor a markdown file offers: one per heading (numbered
 * `-1`, `-2`, ... for repeats, as GitHub does) plus explicit ids and names.
 * Frontmatter and fenced code blocks are skipped, so a heading-shaped line in
 * an example is not a target.
 */
function extractAnchors(content) {
  const anchors = new Set();
  const seen = new Map();
  const prose = [];
  let fence = null;
  // GitHub renders YAML frontmatter as a table, so its `#` comments are not headings.
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  for (const line of body.split('\n')) {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    prose.push(line);
    const h = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (!h) continue;
    const base = headingToAnchor(h[1].trim());
    let slug = base;
    while (seen.has(slug)) {
      seen.set(base, seen.get(base) + 1);
      slug = `${base}-${seen.get(base)}`;
    }
    seen.set(slug, 0);
    anchors.add(slug);
  }
  let m;
  const visible = prose.join('\n');
  EXPLICIT_ANCHOR_RE.lastIndex = 0;
  while ((m = EXPLICIT_ANCHOR_RE.exec(visible)) !== null) anchors.add(m[1]);
  return anchors;
}

const anchorCache = new Map();

/** Anchors of a markdown file, read once per run. */
function anchorsOf(filePath) {
  const key = path.resolve(filePath);
  if (!anchorCache.has(key)) {
    anchorCache.set(key, extractAnchors(fs.readFileSync(key, 'utf8')));
  }
  return anchorCache.get(key);
}

function extractTechDebtAnchors(techDebtPath) {
  if (!fs.existsSync(techDebtPath)) return null;
  return anchorsOf(techDebtPath);
}

function checkAnchorRefs(filePath, content) {
  if (!techDebtAnchors) return 0;
  let okCount = 0;
  let m;
  ANCHOR_REF_RE.lastIndex = 0;
  while ((m = ANCHOR_REF_RE.exec(content)) !== null) {
    const anchor = m[1].toLowerCase();
    if (techDebtAnchors.has(anchor)) {
      okCount++;
    } else {
      pushError({
        category: 'stale-anchor',
        file: filePath,
        message:
          `stale tech-debt anchor reference "tech-debt.md#${anchor}" — ` +
          `no heading with that anchor exists in docs/architecture/tech-debt.md. ` +
          `Either restore/rename the heading, or rewrite the reference.`,
        target: anchor,
      });
    }
  }
  return okCount;
}

// ────────────────────────────────────────────────────────────────────

const errors = [];
let filesChecked = 0;
const techDebtAnchors = extractTechDebtAnchors(TECH_DEBT_PATH);

function pushError(err) {
  errors.push(err);
}

function formatError(err) {
  return `${err.file}: ${err.message}`;
}

function checkRelatedFiles(docPath, content) {
  const fm = readFrontmatter(content);
  const related = parseRelatedFiles(fm);
  for (const rel of related) {
    const target = path.resolve(ROOT_DIR, rel);
    if (!fs.existsSync(target)) {
      pushError({
        category: 'broken-related-file',
        file: docPath,
        message: `related-files path does not exist: ${rel}`,
        target: rel,
      });
    }
  }
  return related.length;
}

function checkBodyLinks(docPath, content) {
  const links = findMarkdownLinks(content);
  for (const { target: link, fragment } of links) {
    // A same-file link has no path part; its target is the doc itself.
    const target = link ? path.resolve(path.dirname(docPath), link) : path.resolve(docPath);
    if (link && !fs.existsSync(target)) {
      pushError({
        category: 'broken-link',
        file: docPath,
        message: `markdown link target does not exist: ${link}`,
        target: link,
      });
      continue;
    }
    checkLinkFragment(docPath, link, fragment, target);
  }
  return links.length;
}

// A link to a .md file, or to the same file, must land on an anchor that file
// has. Links to tech-debt.md from elsewhere are left to checkAnchorRefs so one
// stale slug is not reported twice; a same-file link inside tech-debt.md is
// checked here, since checkAnchorRefs only sees `tech-debt.md#` references.
function checkLinkFragment(docPath, link, fragment, target) {
  if (!fragment || (link && !link.endsWith('.md'))) return;
  if (LINE_ANCHOR_RE.test(fragment)) return;
  if (link && path.resolve(TECH_DEBT_PATH) === target) return;
  if (!fs.statSync(target).isFile()) return;
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // malformed percent-encoding: compare the fragment as written
  }
  const anchors = anchorsOf(target);
  if (anchors.has(decoded) || anchors.has(decoded.toLowerCase())) return;
  pushError({
    category: 'broken-anchor',
    file: docPath,
    message:
      `markdown link anchor does not exist: ${link}#${fragment} — ` +
      `no heading or explicit anchor "${decoded}" in ${path.relative(ROOT_DIR, target)}.`,
    target: `${link}#${fragment}`,
  });
}

// ────────────────────────────────────────────────────────────────────
// Journal-system checks: operate on specific files (progress.md,
// decisions.md) rather than directory iteration. These are post-loop
// because they're whole-file validations, not link / anchor checks.
// ────────────────────────────────────────────────────────────────────

// Structural (not temporal) validation of progress.md frontmatter. A
// well-formed `last-updated: YYYY-MM-DD` is a per-PR property: it's the field
// the tracker, /catchup, and journal-sync all parse, so a malformed one
// silently breaks them. Temporal staleness (how OLD the date is) is handled
// non-blocking elsewhere (see the note near the top).
function checkProgressFrontmatter() {
  if (!fs.existsSync(PROGRESS_PATH)) return; // silent when absent
  const content = fs.readFileSync(PROGRESS_PATH, 'utf8');
  const lastUpdated = getLastUpdated(readFrontmatter(content));
  if (!lastUpdated) {
    pushError({
      category: 'progress-frontmatter',
      file: PROGRESS_PATH,
      message:
        'progress.md is missing or has a malformed `last-updated:` frontmatter field (expected ISO YYYY-MM-DD)',
      target: 'last-updated',
    });
  }
}

// Supersede-chain integrity for docs/decisions.md.
//
// The supersede ritual is a THREE-part edit, applied by hand (or by /log
// decision): the new note gets `**supersedes**: <old>`, and the old note's
// `**status**` flips to `superseded` and gains `**superseded-by**: <new>`.
// Miss any part and the chain lies: a note still reading `accepted` while a
// successor exists is worse than no record, because /catchup and every future
// reader treat these journals as authoritative.
//
// This was previously claimed to be validated and was not: `/log`'s SKILL.md
// asserted `npm run lint:docs` checked "the supersede chain is consistent",
// but no such logic existed anywhere in scripts/.
//
// Two shapes are validated, mirroring what docs/adr/README.md and the ADR
// records already do:
//
//   FULL:      the predecessor flips to `**status**: superseded` and gains
//              `**superseded-by**`; the successor declares `**supersedes**`.
//   PARTIAL:   only some of the predecessor was replaced, so both notes stay
//              `accepted` (both are still live) and the relationship is carried
//              by `**partially-supersedes**` / `**partially-superseded-by**`,
//              each annotated with the scope that moved. This mirrors ADR
//              0003/0004 and 0008/0011, where the partially-superseded record
//              keeps `**Status:** Accepted`.
//
// Both shapes are symmetric, every target must resolve, and no note may point
// at itself. `withdrawn` is terminal: a withdrawn decision has no successor, so
// it can neither be superseded nor supersede anything.
//
// Pointers resolve within this file only. Cross-tier (note <-> ADR) references
// are not fields, by design: the house convention is a prose markdown link,
// which checkBodyLinks already validates.
function checkDecisionsSupersedeChain() {
  if (!fs.existsSync(DECISIONS_PATH)) return;
  const lines = fs.readFileSync(DECISIONS_PATH, 'utf8').split(/\r?\n/);

  // Matches ANY `**field**:` line. Used only to find where a note's header
  // block ends, so it is intentionally wider than the set of fields we read.
  const FIELD_LINE_RE = /^\*\*[a-z-]+\*\*:/;
  const CHAIN_FIELD_RE =
    /^\*\*(status|supersedes|superseded-by|partially-supersedes|partially-superseded-by)\*\*:\s*(.+)$/;

  const unwrap = (s) => s.trim().replace(/^`|`$/g, '').trim();

  // `<slug> (<what was replaced>)`, slug optionally backticked. The scope
  // annotation is required: a partial supersede that doesn't say which part
  // moved isn't a usable record, and both ADR precedents carry one.
  const parsePartial = (raw) => {
    const m = /^`?([^`\s]+)`?\s+\((.+)\)$/.exec(raw.trim());
    return m ? { slug: m[1], scope: m[2].trim() } : null;
  };

  // File order, duplicates kept so they can be reported rather than shadowed.
  const notes = [];
  let current = null;
  let inCodeFence = false;
  let inHeaderBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      inHeaderBlock = false;
      continue;
    }
    if (inCodeFence) continue;

    const heading = /^##\s+decision-id:\s*(\S+)\s*$/.exec(line);
    if (heading) {
      current = { slug: unwrap(heading[1]), line: i + 1, fields: new Map(), dupeFields: [] };
      notes.push(current);
      inHeaderBlock = true;
      continue;
    }
    if (!current || !inHeaderBlock) continue;

    // A note's fields are the contiguous run of `**field**:` lines following
    // its heading (blank lines allowed). The first line that is neither blank
    // nor a field line closes the block, so body prose that happens to begin
    // with `**status**:` can never be read as a field.
    if (line.trim() === '') continue;
    if (!FIELD_LINE_RE.test(line)) {
      inHeaderBlock = false;
      continue;
    }

    const field = CHAIN_FIELD_RE.exec(line);
    if (!field) continue; // a field we don't validate (**date**, **related-files**)
    const [, name, raw] = field;
    if (current.fields.has(name)) current.dupeFields.push({ name, line: i + 1 });
    else current.fields.set(name, { value: unwrap(raw), raw: raw.trim(), line: i + 1 });
  }

  const err = (note, message, line) =>
    pushError({
      category: 'decisions-supersede-chain',
      file: DECISIONS_PATH,
      message: `decision note "${note.slug}" (line ${line ?? note.line}) ${message}`,
      target: note.slug,
    });

  // Duplicate slugs are reported, then the shadowed copy is skipped: carrying
  // both would misattribute every downstream pointer error to the wrong record.
  const bySlug = new Map();
  for (const note of notes) {
    const first = bySlug.get(note.slug);
    if (first) {
      err(
        note,
        `duplicates the decision-id first defined at line ${first.line} — slugs are ` +
          'stable references and must be unique',
      );
    } else {
      bySlug.set(note.slug, note);
    }
  }

  const get = (note, name) => note.fields.get(name) ?? null;

  for (const note of bySlug.values()) {
    for (const dupe of note.dupeFields) {
      err(
        note,
        `declares \`**${dupe.name}**:\` more than once — one value per field; a note ` +
          'supersedes at most one predecessor',
        dupe.line,
      );
    }

    const status = get(note, 'status');
    if (status === null) {
      err(note, 'is missing a `**status**:` field');
    } else if (!DECISION_VALID_STATUSES.includes(status.value)) {
      err(
        note,
        `has invalid status "${status.value}" — must be one of: ${DECISION_VALID_STATUSES.join(', ')}`,
        status.line,
      );
    }

    const supersedes = get(note, 'supersedes');
    const supersededBy = get(note, 'superseded-by');

    // A `superseded` status with no successor recorded is the half-applied
    // ritual in its other direction: the note says it was replaced, but not by
    // what, leaving a reader no way to find the record that supplanted it.
    if (status?.value === 'superseded' && !supersededBy) {
      err(
        note,
        'reads `**status**: superseded` but records no `**superseded-by**:` pointer — name ' +
          'the successor slug (a note superseded by an ADR is not expressible as a field; ' +
          'see docs/decisions.md Format)',
        status.line,
      );
    }

    if (status?.value === 'withdrawn') {
      for (const name of ['supersedes', 'partially-supersedes']) {
        const field = get(note, name);
        if (field) {
          err(
            note,
            `is \`withdrawn\` but declares \`**${name}**:\` — a withdrawn note cannot be ` +
              "anyone's successor, or the record it replaced would point at a dead one",
            field.line,
          );
        }
      }
    }

    if (supersedes) {
      const target = bySlug.get(supersedes.value);
      if (supersedes.value === note.slug) {
        err(note, 'supersedes itself', supersedes.line);
      } else if (!target) {
        err(
          note,
          `supersedes "${supersedes.value}", which is not a decision note in this file`,
          supersedes.line,
        );
      } else {
        const backPtr = get(target, 'superseded-by');
        const targetStatus = get(target, 'status');
        if (backPtr?.value !== note.slug) {
          err(
            note,
            `supersedes "${target.slug}", but that note's \`**superseded-by**\` is ` +
              `${backPtr ? `"${backPtr.value}"` : 'missing'} — the supersede ` +
              'ritual is a three-part edit (see docs/decisions.md Format)',
            supersedes.line,
          );
        }
        if (targetStatus?.value === 'withdrawn') {
          err(
            note,
            `supersedes "${target.slug}", but that note is \`withdrawn\` — withdrawn and ` +
              'superseded are different fates, and a withdrawn note has no successor',
            supersedes.line,
          );
        } else if (targetStatus?.value !== 'superseded') {
          err(
            note,
            `supersedes "${target.slug}", but that note still reads \`**status**: ` +
              `${targetStatus?.value ?? '(none)'}\` — flip it to \`superseded\`. If only PART ` +
              'of it was replaced, use `**partially-supersedes**` / `**partially-superseded-by**` ' +
              'instead and leave both notes `accepted`',
            supersedes.line,
          );
        }
      }
    }

    if (supersededBy) {
      const target = bySlug.get(supersededBy.value);
      if (supersededBy.value === note.slug) {
        err(note, 'is superseded by itself', supersededBy.line);
      } else if (!target) {
        err(
          note,
          `is superseded-by "${supersededBy.value}", which is not a decision note in this file`,
          supersededBy.line,
        );
      } else if (get(target, 'supersedes')?.value !== note.slug) {
        err(
          note,
          `is superseded-by "${target.slug}", but that note does not declare ` +
            '`**supersedes**` back — the pointers must be symmetric',
          supersededBy.line,
        );
      }
    }

    // Partial supersede. Both notes stay `accepted` because both are still
    // live, so this pair is exempt from the status-flip rule.
    for (const [name, mirrorName] of [
      ['partially-supersedes', 'partially-superseded-by'],
      ['partially-superseded-by', 'partially-supersedes'],
    ]) {
      const field = get(note, name);
      if (!field) continue;

      const parsed = parsePartial(field.raw);
      if (!parsed) {
        err(
          note,
          `has a malformed \`**${name}**:\` value "${field.raw}" — expected ` +
            '`<slug> (<what was replaced>)`; the scope annotation is required',
          field.line,
        );
        continue;
      }
      if (parsed.slug === note.slug) {
        err(note, `\`**${name}**\` points at itself`, field.line);
        continue;
      }
      const target = bySlug.get(parsed.slug);
      if (!target) {
        err(
          note,
          `\`**${name}**\` names "${parsed.slug}", which is not a decision note in this file`,
          field.line,
        );
        continue;
      }

      const mirror = get(target, mirrorName);
      if (parsePartial(mirror?.raw ?? '')?.slug !== note.slug) {
        err(
          note,
          `\`**${name}**\` names "${target.slug}", but that note's \`**${mirrorName}**\` is ` +
            `${mirror ? `"${mirror.raw}"` : 'missing'} — partial supersedes are symmetric too`,
          field.line,
        );
      }
      if (name === 'partially-supersedes' && get(target, 'status')?.value === 'withdrawn') {
        err(
          note,
          `\`**${name}**\` names "${target.slug}", which is \`withdrawn\` — a withdrawn note ` +
            'has no successor',
          field.line,
        );
      }
    }
  }
}

// Every .md in dir and its subfolders (docs/user/features/ is one), so a doc in a
// subfolder is checked like any other.
function checkDirOfMds(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relatedCount = checkRelatedFiles(file, content);
    const linkCount = checkBodyLinks(file, content);
    const anchorCount = checkAnchorRefs(file, content);
    filesChecked++;
    if (VERBOSE) {
      console.log(
        `  ${path.relative(ROOT_DIR, file)} — ${relatedCount} related, ${linkCount} links, ${anchorCount} anchors`,
      );
    }
  }
}

// Architecture docs
checkDirOfMds(ARCH_DIR);

// Dev how-to guides
checkDirOfMds(DEV_DIR);

// User guides (published at docs.jellyrock.app; their links are rewritten for
// the site, so a link that's broken here is broken there too)
checkDirOfMds(USER_DIR);

// Architecture Decision Records (body links + tech-debt anchors; ADRs carry no
// YAML frontmatter, so related-files validation is a no-op for them)
checkDirOfMds(ADR_DIR);

// Decisions log (no frontmatter; check only body links + slug refs)
if (fs.existsSync(DECISIONS_PATH)) {
  const content = fs.readFileSync(DECISIONS_PATH, 'utf8');
  const linkCount = checkBodyLinks(DECISIONS_PATH, content);
  const anchorCount = checkAnchorRefs(DECISIONS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(
      `  ${path.relative(ROOT_DIR, DECISIONS_PATH)} — ${linkCount} links, ${anchorCount} anchors`,
    );
  }
}

// Progress journal: body links + tech-debt anchor refs only. `last-updated`
// staleness is intentionally not gated here (see the note near the top).
if (fs.existsSync(PROGRESS_PATH)) {
  const content = fs.readFileSync(PROGRESS_PATH, 'utf8');
  const linkCount = checkBodyLinks(PROGRESS_PATH, content);
  const anchorCount = checkAnchorRefs(PROGRESS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(
      `  ${path.relative(ROOT_DIR, PROGRESS_PATH)} — ${linkCount} links, ${anchorCount} anchors`,
    );
  }
}

// CLAUDE.md files: root + every subdir-scoped one. These are the agent-context
// rules; their cross-references to docs/architecture/ go stale the same way
// and are equally important to validate.
function findClaudeMds(rootDir) {
  const found = [];
  // Skip directories that don't host project source / docs
  const skipDirs = new Set(['node_modules', 'build', 'build-analysis', 'out', '.git', '.husky']);
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        // The repo-root `tasks/` is gitignored; a nested `components/tasks/` is tracked.
        if (path.relative(rootDir, full) === 'tasks') continue;
        walk(full);
      } else if (e.name === 'CLAUDE.md') {
        found.push(path.join(dir, e.name));
      }
    }
  }
  walk(rootDir);
  return found.sort();
}

for (const file of findClaudeMds(ROOT_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  const linkCount = checkBodyLinks(file, content);
  const anchorCount = checkAnchorRefs(file, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, file)} — ${linkCount} links, ${anchorCount} anchors`);
  }
}

// BSC convention plugin sources: their JSDoc headers + diagnostic strings
// frequently cite tech-debt slugs (the plugins enforce conventions documented
// there). These are .cjs, not .md, but the slug-ref regex doesn't care.
function findPluginScripts() {
  const pluginsDir = path.join(SCRIPTS_DIR, 'bsc-plugins');
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir)
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => path.join(pluginsDir, f))
    .sort();
}

for (const file of findPluginScripts()) {
  const content = fs.readFileSync(file, 'utf8');
  const anchorCount = checkAnchorRefs(file, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, file)} — ${anchorCount} anchors`);
  }
}

// The Roku store descriptions in docs/admin/store-listing.md, one fenced
// block each (```text store-on-device, ```text store-online). The limits are
// the Developer Dashboard's. Each line break counts as two characters, since
// the dashboard may count it as CRLF, so a block that passes here fits either
// way.
const STORE_BLOCKS = [
  { name: 'store-on-device', limit: 300 },
  { name: 'store-online', limit: 1500 },
];
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];
const COUNT_RE = new RegExp(`\\b(\\d+|${NUMBER_WORDS.join('|')}) (languages|themes)\\b`, 'gi');
const SERVER_RE = /\bJellyfin (\d+\.\d+(?:\.\d+)?) or later\b/g;

function checkStoreListing() {
  if (!fs.existsSync(STORE_LISTING_PATH)) return; // silent when absent
  const content = fs.readFileSync(STORE_LISTING_PATH, 'utf8');
  const fail = (message, target) =>
    pushError({ category: 'store-listing', file: STORE_LISTING_PATH, message, target });
  const facts = appFacts(ROOT_DIR);
  for (const { name, limit } of STORE_BLOCKS) {
    const match = content.match(new RegExp('^```text ' + name + '\\n([\\s\\S]*?)\\n```$', 'm'));
    if (!match) {
      fail(`no \`\`\`text ${name} block`, name);
      continue;
    }
    const text = match[1];
    const length = Array.from(text).length + (text.match(/\n/g) || []).length;
    if (length > limit) {
      fail(`${name} is ${length} characters, over its limit of ${limit}`, name);
    }
    checkCitedCounts(text, name, facts, fail);
  }
}

// Each count a text cites ("98 languages", "nine themes", "Jellyfin 10.7 or
// later") must match the app. `name` labels the text in the message.
function checkCitedCounts(text, name, facts, fail) {
  for (const [, said, noun] of text.matchAll(COUNT_RE)) {
    const value = /^\d+$/.test(said) ? Number(said) : NUMBER_WORDS.indexOf(said.toLowerCase());
    const kind = noun.toLowerCase();
    const actual = facts[kind];
    if (value === actual) continue;
    fail(
      kind === 'languages'
        ? `${name} says ${said} languages, but locale/languages.json has ${actual}`
        : `${name} says ${said} themes, but the uiTheme setting has ${actual} presets`,
      kind,
    );
  }
  for (const [, said] of text.matchAll(SERVER_RE)) {
    if (facts.floor === said || facts.floor.startsWith(`${said}.`)) continue;
    fail(`${name} says Jellyfin ${said}, but the supported floor is ${facts.floor}`, 'floor');
  }
}

// The README cites the same counts as the store text, typed by hand.
function checkReadmeCounts() {
  const readme = path.join(ROOT_DIR, 'README.md');
  if (!fs.existsSync(readme)) return; // silent when absent
  const fail = (message, target) =>
    pushError({ category: 'readme-counts', file: readme, message, target });
  checkCitedCounts(fs.readFileSync(readme, 'utf8'), 'README.md', appFacts(ROOT_DIR), fail);
}

// The frontmatter of every page in docs/user/features/ (parsed by
// scripts/lib/feature-facts.cjs, as the feature catalog's generator parses it).
// Every field is checked against what the app ships, and an unknown key fails,
// so a misspelled field is never silently ignored.
const PITCH_LIMIT = 120;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function checkFeaturePages() {
  const names = featurePageFiles(ROOT_DIR);
  if (names.length === 0) return; // silent when absent
  const version = appVersion(ROOT_DIR);
  const floor = readServerFloor(ROOT_DIR);
  const plugins = listedPlugins(ROOT_DIR);
  const screens = screenshotKeys(ROOT_DIR);
  for (const name of names) {
    const file = path.join(FEATURES_DIR, name);
    const fail = (message, target) =>
      pushError({ category: 'feature-frontmatter', file, message, target });
    const { fields, problems } = parseFeaturePage(fs.readFileSync(file, 'utf8'));
    if (fields === null) {
      fail('has no frontmatter: a feature page needs pitch, since and server', 'frontmatter');
      continue;
    }
    for (const problem of problems) fail(problem, 'frontmatter');
    for (const [key, { required }] of Object.entries(FEATURE_FIELDS)) {
      if (required && !(key in fields)) fail(`missing \`${key}:\``, key);
    }
    const { pitch, since, server } = fields;
    if (pitch && Array.from(pitch).length > PITCH_LIMIT) {
      fail(
        `pitch is ${Array.from(pitch).length} characters, over its limit of ${PITCH_LIMIT}`,
        'pitch',
      );
    }
    if (since && since !== 'unreleased') {
      if (!VERSION_RE.test(since)) fail(`since: ${since} is not x.y.z or \`unreleased\``, 'since');
      else if (compareVersions(since, version) > 0) {
        fail(`since: ${since} is newer than the app (${version})`, 'since');
      }
    }
    if (server) {
      if (!VERSION_RE.test(server)) fail(`server: ${server} is not x.y.z`, 'server');
      else if (compareVersions(server, floor) < 0) {
        fail(`server: ${server} is older than the supported floor (${floor})`, 'server');
      }
    }
    for (const plugin of fields.plugins || []) {
      if (!plugins.has(plugin)) {
        fail(`plugin "${plugin}" is not a row in docs/user/jellyfin-server-plugins.md`, 'plugins');
      }
    }
    for (const key of fields.screenshots || []) {
      if (!screens.has(key)) {
        fail(`screenshot "${key}" is not in docs/screenshots/screenshots.json`, 'screenshots');
      }
    }
  }
}

// Post-loop journal-system checks. These don't iterate files (they target
// specific paths) so they run after the per-file scan so their errors
// participate in the same accumulator.
checkProgressFrontmatter();
checkDecisionsSupersedeChain();
checkStoreListing();
checkReadmeCounts();
checkFeaturePages();

if (JSON_MODE) {
  // Single-line JSON to stdout regardless of pass/fail. Exit code carries
  // the pass/fail signal so a consumer can pipe + check in one shot.
  process.stdout.write(
    JSON.stringify({
      filesChecked,
      errorsCount: errors.length,
      errors,
    }) + '\n',
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

if (errors.length > 0) {
  console.error(`docs:check found ${errors.length} broken reference(s):\n`);
  for (const err of errors) console.error(`  ${formatError(err)}`);
  console.error('');
  process.exit(1);
}

console.log(`docs:check: ${filesChecked} file(s) clean`);
process.exit(0);
