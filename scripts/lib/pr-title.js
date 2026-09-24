/**
 * What a PR title's type means: which CHANGELOG.md section the change lands in.
 *
 * The repo squash-merges, so a PR title becomes the first line of its commit on `main`,
 * and `scripts/changelog-syncer.js` builds CHANGELOG.md from those lines. The type
 * before the colon is therefore the one input that places a change in the release
 * notes. This module is the single definition of that mapping, read by:
 *
 *   - `scripts/changelog-syncer.js` — sorts and words each changelog line
 *   - `scripts/lint/pr-body-check.js` — fails a PR whose title has no known type
 *   - the `/pr` skill — picks the type when it titles a PR
 *
 * A title is `type(scope)!: Subject` (Conventional Commits 1.0), where the scope and
 * the `!` are optional. Types are case-insensitive, as the spec requires. The set is
 * the spec's own types plus the plain verbs this repo has always used (`add:`,
 * `update:`, `remove:` …), each placed in one of the sections below.
 */

/** The sections CHANGELOG.md renders, in order. */
export const CHANGELOG_SECTIONS = Object.freeze([
  'Added',
  'Changed',
  'Fixed',
  'Removed',
  'Dependencies',
]);

/**
 * Every type a title may use, and its section. `null` keeps the change out of the
 * changelog: work that ships nothing to the app (tooling, CI, tests, docs).
 */
export const TITLE_TYPES = Object.freeze({
  feat: 'Added',
  add: 'Added',
  new: 'Added',
  implement: 'Added',
  create: 'Added',

  update: 'Changed',
  change: 'Changed',
  changed: 'Changed',
  improve: 'Changed',
  enhance: 'Changed',
  refactor: 'Changed',
  perf: 'Changed',
  revert: 'Changed',

  fix: 'Fixed',
  bugfix: 'Fixed',
  hotfix: 'Fixed',
  resolve: 'Fixed',
  correct: 'Fixed',
  repair: 'Fixed',
  security: 'Fixed',

  remove: 'Removed',
  delete: 'Removed',
  drop: 'Removed',

  deps: 'Dependencies',

  chore: null,
  ci: null,
  build: null,
  docs: null,
  test: null,
  tests: null,
  style: null,
});

/** The scope that routes any type to Dependencies (Renovate's `chore(deps): …`). */
const DEPENDENCY_SCOPE = 'deps';

// type, then an optional (scope) holding anything but parentheses, an optional `!`,
// the colon, and the rest. Deliberately loose past the colon so the changelog can read
// imperfect titles already on `main` (the sync bot's own `chore:(docs) sync …`);
// titleProblems() is where a NEW title is held to the exact form.
const TITLE_RE = /^([A-Za-z]+)(?:\(([^()]*)\))?(!)?:(\s*)(.*)$/;

// GitHub's Revert button titles its PR `Revert "<original title>"`.
const GITHUB_REVERT_RE = /^Revert "(.+)"$/;

/**
 * @param {string} title
 * @returns {{type: string, scope: string|null, breaking: boolean, subject: string, spaced: boolean}|null}
 *   `type` lower-cased; `spaced` is whether whitespace follows the colon. Null when the
 *   title has no `type:` prefix at all.
 */
export function parseTitle(title) {
  const text = String(title ?? '').trim();
  if (GITHUB_REVERT_RE.test(text)) {
    return { type: 'revert', scope: null, breaking: false, subject: text, spaced: true };
  }
  const m = text.match(TITLE_RE);
  if (!m) return null;
  return {
    type: m[1].toLowerCase(),
    scope: m[2] ?? null,
    breaking: m[3] === '!',
    subject: m[5].trim(),
    spaced: m[4].length > 0,
  };
}

/** Whether `type` is one TITLE_TYPES defines. */
export function isKnownType(type) {
  return Object.hasOwn(TITLE_TYPES, type);
}

/**
 * The CHANGELOG.md section a title's change belongs in, or null to leave it out.
 *
 * A title with no known type lands in Changed. It is not guessed from its words: that
 * is what dropped "Cinema mode: …" as a CI change and filed "Fixture loading …" under
 * Fixed. pr-body-check stops such a title at PR time, so reaching here takes a direct
 * push; the fix is to retitle the PR, which the syncer reads (see changelog-syncer.js).
 *
 * @param {string} title
 * @param {{isDependency?: boolean}} [opts] isDependency: the PR carries a dependency label
 * @returns {string|null}
 */
export function changelogSection(title, { isDependency = false } = {}) {
  if (isDependency) return 'Dependencies';
  const parsed = parseTitle(title);
  if (!parsed || !isKnownType(parsed.type)) return 'Changed';
  if (parsed.scope?.trim().toLowerCase() === DEPENDENCY_SCOPE) return 'Dependencies';
  return TITLE_TYPES[parsed.type];
}

/**
 * A title's changelog line: the type (and any `!`) removed, the scope kept in front for
 * the area it names — `fix(skills): Make X` reads `(skills) Make X`. A title with no
 * known type is used whole, since there is nothing to remove.
 *
 * @param {string} title
 * @returns {string}
 */
export function changelogText(title) {
  const text = String(title ?? '').trim();
  const parsed = parseTitle(text);
  if (!parsed || !isKnownType(parsed.type) || !parsed.subject) return text;
  const scope = parsed.scope?.trim();
  return scope ? `(${scope}) ${parsed.subject}` : parsed.subject;
}

/** The types each section accepts, for messages: `Added: feat, add, …`. */
export function describeTypes() {
  const bySection = new Map([...CHANGELOG_SECTIONS, null].map((s) => [s, []]));
  for (const [type, section] of Object.entries(TITLE_TYPES)) bySection.get(section).push(type);
  return [...bySection].map(
    ([section, types]) => `${section ?? 'Not in the changelog'}: ${types.join(', ')}`,
  );
}

/**
 * Why a new PR title does not have the required form, or an empty list when it does.
 *
 * @param {string} title
 * @returns {string[]}
 */
export function titleProblems(title) {
  const text = String(title ?? '').trim();
  if (!text) return ['the PR title is empty'];
  const parsed = parseTitle(text);
  if (!parsed) {
    return [
      `the PR title has no type — start it with "type: ", e.g. "fix: ${text}"; the type sets where it lands in CHANGELOG.md`,
    ];
  }
  const problems = [];
  if (!isKnownType(parsed.type)) {
    problems.push(`"${parsed.type}" is not a known type`);
  }
  if (parsed.scope !== null) {
    if (!parsed.scope.trim()) {
      problems.push(
        'the scope in "()" is empty — name an area, e.g. "fix(video): …", or drop the "()"',
      );
    } else if (parsed.scope !== parsed.scope.trim()) {
      problems.push(`the scope "(${parsed.scope})" starts or ends with a space`);
    }
  }
  if (!parsed.spaced && parsed.subject) {
    problems.push('put a space after the ":"');
  }
  if (!parsed.subject) {
    problems.push('the PR title has nothing after the ":"');
  }
  return problems;
}
