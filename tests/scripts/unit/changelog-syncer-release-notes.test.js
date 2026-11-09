/**
 * `release-notes <version>` prints a draft release's body: the Release Schedule, the
 * summary already in the draft, the version's changelog section with people as plain
 * mentions, a Full Changelog link and the support block.
 *
 * People become `@login` because in a release body that is a mention, while in
 * CHANGELOG.md it is plain text and so is written as a link. Bots keep their app link:
 * `@renovate[bot]` would mention the unrelated user account `renovate`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { execSync, execFileSync } = vi.hoisted(() => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execSync, execFileSync }));

const { ChangelogSyncer } = await import('../../../scripts/changelog-syncer.js');

const URL = 'https://github.com/jellyrock/jellyrock';
const STORE =
  'https://channelstore.roku.com/details/232f9e82db11ce628e3fe7e01382a330:a85d6e9e520567806e8dae1c0cabadd5/jellyrock';
const SUPPORT = '## Support JellyRock\n\n- [Donate](https://example.org/donate)\n';

const CHANGELOG = `<!-- markdownlint-disable -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- (playback) Show buttons ([#913](${URL}/pull/913)) by [@new-dev](https://github.com/new-dev)

### Dependencies

- Update vitest to v5.1.0 ([#1311](${URL}/pull/1311)) by [@renovate[bot]](https://github.com/apps/renovate)

### New Contributors

- [@new-dev](https://github.com/new-dev) made their first contribution in [#913](${URL}/pull/913)

## [1.1.0](${URL}/compare/v1.0.4...v1.1.0) - 2025-01-02

### Added

- Add a thing ([#411](${URL}/pull/411)) by [@first-dev](https://github.com/first-dev), Pat Example

## [1.0.4](${URL}/compare/v1.0.3...v1.0.4) - 2025-01-01

### Fixed

- Fix a thing ([aaaaaaa](${URL}/commit/${'a'.repeat(40)})) by [@cewert](https://github.com/cewert)
`;

/**
 * Wire the mocks: `git tag` lists `tags`; `gh release view` answers `draftBody` (null:
 * no release); `gh api` answers `support` (null: the file is missing).
 */
function stub({
  tags = ['v1.1.0', 'v1.0.4', 'v1.0.3'],
  draftBody = null,
  support = SUPPORT,
  fail,
} = {}) {
  const calls = [];
  execSync.mockImplementation((cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('git tag')) return tags.join('\n') + '\n';
    throw new Error(`unexpected command: ${cmd}`);
  });
  execFileSync.mockImplementation((file, args) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    if (fail && fail.test(cmd)) {
      throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 502: Bad Gateway' });
    }
    if (file === 'gh' && args[0] === 'release' && args[1] === 'view') {
      if (draftBody === null) {
        throw Object.assign(new Error('Command failed'), { stderr: 'release not found\n' });
      }
      return JSON.stringify({ body: draftBody });
    }
    if (file === 'gh' && args[0] === 'api' && args.some((a) => a.includes('snippets/support.md'))) {
      if (support === null) {
        throw Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)' });
      }
      return support;
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
  return calls;
}

// Sunday 2026-11-08 at noon Pacific: the next store release is Monday.
const NOW = new Date('2026-11-08T20:00:00Z');

describe('changelog-syncer: release-notes', () => {
  let dir;
  let syncer;

  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
    syncer = new ChangelogSyncer();
    syncer.changelogPath = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(syncer.changelogPath, CHANGELOG);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('builds a draft from [Unreleased] in the body order, people as mentions, bots as links', () => {
    stub();
    expect(syncer.releaseNotes('1.2.0', NOW)).toBe(`## Release Schedule

JellyRock v1.2.0 is scheduled for release on the [Roku Channel Store](${STORE}) Monday, November 09, 2026 6:00 PM PT

<!-- No summary yet: run /release-summary 1.2.0 before you publish -->

### Fixed

- (playback) Show buttons ([#913](${URL}/pull/913)) by @new-dev

### Dependencies

- Update vitest to v5.1.0 ([#1311](${URL}/pull/1311)) by [@renovate[bot]](https://github.com/apps/renovate)

### New Contributors

- @new-dev made their first contribution in [#913](${URL}/pull/913)

**Full Changelog**: ${URL}/compare/v1.1.0...v1.2.0

${SUPPORT}`);
  });

  it('keeps the summary already in the draft, from its heading to the next one', () => {
    stub({
      draftBody:
        '## Release Schedule\n\nold date\n\n### Summary\n\nA fix release.\n\n- Buttons show again (#913)\n\n### Fixed\n\n- stale line\n',
    });
    const body = syncer.releaseNotes('1.2.0', NOW);
    expect(body).toContain(
      '6:00 PM PT\n\n### Summary\n\nA fix release.\n\n- Buttons show again (#913)\n\n### Fixed\n',
    );
    expect(body).not.toContain('stale line');
    expect(body).not.toContain('old date');
    expect(body).not.toContain('No summary yet');
  });

  it('keeps a summary the GitHub editor saved with CRLF line ends, as LF', () => {
    stub({
      draftBody:
        '## Release Schedule\r\n\r\nold date\r\n\r\n### Summary\r\n\r\nOne.\r\nTwo.\r\n\r\n### Fixed\r\n',
    });
    const body = syncer.releaseNotes('1.2.0', NOW);
    expect(body).toContain('6:00 PM PT\n\n### Summary\n\nOne.\nTwo.\n\n### Fixed\n');
    expect(body).not.toContain('\r');
  });

  it('puts no reminder in the notes of a released version, which has no draft to edit', () => {
    stub();
    expect(syncer.releaseNotes('1.1.0', NOW)).not.toContain('No summary yet');
  });

  it('builds a released version from its own section and links the compare range', () => {
    stub();
    const body = syncer.releaseNotes('1.1.0', NOW);
    expect(body).toContain(
      `- Add a thing ([#411](${URL}/pull/411)) by @first-dev, Pat Example\n\n**Full Changelog**: ${URL}/compare/v1.0.4...v1.1.0\n`,
    );
    expect(body).not.toContain('Show buttons');
    expect(body).not.toContain('Fix a thing');
  });

  it('uses the newest tag below the version as the compare base', () => {
    stub({ tags: ['v1.2.0', 'v1.1.0', 'v1.0.4'] });
    expect(syncer.releaseNotes('1.1.1', NOW)).toContain(
      `**Full Changelog**: ${URL}/compare/v1.1.0...v1.1.1\n`,
    );
  });

  it('fails when the checkout has no tag below a released section, instead of linking all history', () => {
    stub({ tags: [] });
    expect(() => syncer.releaseNotes('1.2.0', NOW)).toThrow(/\[1\.1\.0\].*fetch the tags/);
  });

  it('links all history for the first release, which has no earlier section', () => {
    fs.writeFileSync(syncer.changelogPath, CHANGELOG.slice(0, CHANGELOG.indexOf('## [1.1.0]')));
    stub({ tags: [] });
    expect(syncer.releaseNotes('1.2.0', NOW)).toContain(
      `**Full Changelog**: ${URL}/commits/v1.2.0\n`,
    );
  });

  it('works out the store date in Pacific time across the week', () => {
    // [UTC instant, the weekday it is in Pacific time, the date printed]
    const cases = [
      ['2026-11-09T20:00:00Z', 'Tuesday, November 10, 2026'], // Monday
      ['2026-11-13T20:00:00Z', 'Monday, November 16, 2026'], // Friday
      ['2026-11-14T20:00:00Z', 'Monday, November 16, 2026'], // Saturday
      ['2026-11-10T06:30:00Z', 'Tuesday, November 10, 2026'], // still Monday in Pacific
      ['2026-12-31T20:00:00Z', 'Friday, January 01, 2027'], // Thursday, across the year
    ];
    for (const [now, expected] of cases) {
      expect(syncer.storeReleaseDate(new Date(now))).toBe(expected);
    }
  });

  it('fails when the support block cannot be read', () => {
    stub({ support: null });
    expect(() => syncer.releaseNotes('1.2.0', NOW)).toThrow(/snippets\/support\.md/);
  });

  it('fails when the support block does not start with its heading', () => {
    stub({ support: '# Support\n\nDonate\n' });
    expect(() => syncer.releaseNotes('1.2.0', NOW)).toThrow(/## Support JellyRock/);
  });

  it('fails when the draft cannot be read for a reason other than there being none', () => {
    stub({ fail: /release view/ });
    expect(() => syncer.releaseNotes('1.2.0', NOW)).toThrow(/HTTP 502/);
  });

  it('fails when the changelog has no section for the version', () => {
    fs.writeFileSync(syncer.changelogPath, CHANGELOG.replace('## [Unreleased]', '## Draft'));
    stub();
    expect(() => syncer.releaseNotes('1.2.0', NOW)).toThrow(/\[Unreleased\] or \[1\.2\.0\]/);
  });

  it('rejects a version that is not x.y.z', () => {
    stub();
    expect(() => syncer.releaseNotes('v1.2.0', NOW)).toThrow(/Invalid version/);
  });

  it('asks for the draft and the support block by exact names', () => {
    const calls = stub();
    syncer.releaseNotes('1.2.0', NOW);
    expect(calls).toContain('gh release view v1.2.0 --repo jellyrock/jellyrock --json body');
    expect(calls).toContain(
      'gh api -H Accept: application/vnd.github.raw+json repos/jellyrock/.github/contents/snippets/support.md',
    );
  });
});

/**
 * `add-summary <version>` runs after publish: it copies the published release's
 * `### Summary` to the top of the version's CHANGELOG.md section, where later summaries
 * read it as an example. No summary leaves the changelog alone; a failed read fails.
 */
describe('changelog-syncer: add-summary', () => {
  const SUMMARY = '### Summary\n\nA feature release.\n\n- A thing is added (#411)';
  const PUBLISHED = `## Release Schedule\n\ndate\n\n${SUMMARY}\n\n### Added\n\n- line\n`;
  let dir;
  let syncer;

  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-summary-'));
    syncer = new ChangelogSyncer();
    syncer.changelogPath = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(syncer.changelogPath, CHANGELOG);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const read = () => fs.readFileSync(syncer.changelogPath, 'utf8');

  it('puts the summary at the top of the version section', () => {
    const calls = stub({ draftBody: PUBLISHED });
    expect(syncer.addSummary('1.1.0')).toBe(true);
    expect(read()).toBe(
      CHANGELOG.replace(
        `## [1.1.0](${URL}/compare/v1.0.4...v1.1.0) - 2025-01-02\n`,
        `## [1.1.0](${URL}/compare/v1.0.4...v1.1.0) - 2025-01-02\n\n${SUMMARY}\n`,
      ),
    );
    expect(calls).toContain('gh release view v1.1.0 --repo jellyrock/jellyrock --json body');
  });

  it('changes nothing on a second run', () => {
    stub({ draftBody: PUBLISHED });
    syncer.addSummary('1.1.0');
    const once = read();
    expect(syncer.addSummary('1.1.0')).toBe(false);
    expect(read()).toBe(once);
  });

  it('writes LF from a release the GitHub editor saved with CRLF, once', () => {
    stub({ draftBody: PUBLISHED.replace(/\n/g, '\r\n') });
    expect(syncer.addSummary('1.1.0')).toBe(true);
    const once = read();
    expect(once).not.toContain('\r');
    expect(once).toContain(`2025-01-02\n\n${SUMMARY}\n`);
    expect(syncer.addSummary('1.1.0')).toBe(false);
    expect(read()).toBe(once);
  });

  it('leaves the changelog alone when the release has no summary', () => {
    stub({ draftBody: '## Release Schedule\n\ndate\n\n### Added\n\n- line\n' });
    expect(syncer.addSummary('1.1.0')).toBe(false);
    expect(read()).toBe(CHANGELOG);
  });

  it('leaves the changelog alone when there is no release', () => {
    stub();
    expect(syncer.addSummary('1.1.0')).toBe(false);
    expect(read()).toBe(CHANGELOG);
  });

  it('fails, writing nothing, when the release cannot be read', () => {
    stub({ fail: /release view/ });
    expect(() => syncer.addSummary('1.1.0')).toThrow(/HTTP 502/);
    expect(read()).toBe(CHANGELOG);
  });

  it('fails when the version has no released section, rather than writing into [Unreleased]', () => {
    stub({ draftBody: PUBLISHED });
    expect(() => syncer.addSummary('1.2.0')).toThrow(/no \[1\.2\.0\] section/);
    expect(read()).toBe(CHANGELOG);
  });

  it('rejects a version that is not x.y.z', () => {
    stub();
    expect(() => syncer.addSummary('v1.1.0')).toThrow(/Invalid version/);
  });

  it('release-notes prints a section summary once, in place of the draft one', () => {
    stub({ draftBody: PUBLISHED });
    syncer.addSummary('1.1.0');
    stub({ draftBody: PUBLISHED.replace('A feature release.', 'Edited on the page.') });
    const body = syncer.releaseNotes('1.1.0', NOW);
    expect(body.match(/### Summary/g)).toHaveLength(1);
    expect(body).toContain('A feature release.');
    expect(body).not.toContain('Edited on the page.');
  });
});
