// scripts/roku-os-watch.js: decides whether a new Roku OS release needs a review
// issue. Run weekly by the `roku-os` job in .github/workflows/roku-hardware-sync.yml,
// which does the GitHub writes; this script only reads.
//
// The newest Roku OS is the first `## Roku OS X.Y` heading in rokudev/dev-doc's
// release notes on GitLab (fetchRokuOs()). There is one issue per version (label `roku-os`,
// found by exact title, any state), so a version is announced once and closing
// its issue is the acknowledgment. Nothing in the repo stores the last reviewed
// version: the closed issues are that record.
//
// CLI:
//   node scripts/roku-os-watch.js [--version <X.Y>] [--issues <file.json>] [--body-out <file>]
//     --version   override the live fetch (tests / workflow_dispatch)
//     --issues    gh JSON ([{title}]) of the `roku-os` issues, for `since` and `exists`
//     --body-out  write the issue body to this path
//   Prints decision JSON: { version, title, label, since, exists }
//     since   the newest earlier version with an issue, or null
//     exists  true when this version's issue is already open or closed

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchRokuOs, compareSemverBase } = require('./lib/signals-fetch.cjs');

export const ROKU_OS_LABEL = 'roku-os';

export function rokuOsTitle(version) {
  return `[roku-os] Roku OS ${version} released`;
}

const TITLE_RE = /^\[roku-os\] Roku OS (\d+\.\d+(?:\.\d+)?) released$/;

export function decideRokuOs({ version, issues = [] }) {
  const title = rokuOsTitle(version);
  const versions = issues.map((i) => String(i.title ?? '').match(TITLE_RE)?.[1]).filter(Boolean);
  const earlier = versions.filter((v) => compareSemverBase(v, version) < 0);
  earlier.sort(compareSemverBase);
  return {
    version,
    title,
    label: ROKU_OS_LABEL,
    since: earlier.at(-1) ?? null,
    exists: issues.some((i) => i.title === title),
  };
}

export function renderRokuOsBody({ version, since }) {
  const range = since ? `everything after Roku OS ${since}` : `Roku OS ${version}`;
  return [
    `Roku published release notes for **Roku OS ${version}**.`,
    '',
    `Read ${range} in the [release notes](https://gitlab.com/rokudev/dev-doc/-/blob/v2.0/docs/DEVELOPER/release-notes/index.md) for video pipeline and SceneGraph capability changes. If a codec, DRM or OSD change affects JellyRock, update \`docs/architecture/playback.md\` and file the work.`,
    '',
    'Close this issue once reviewed. Closing it is the acknowledgment.',
    '',
    '_Opened by `.github/workflows/roku-hardware-sync.yml` (job `roku-os`)._',
    '',
  ].join('\n');
}

function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const version = flagValue(argv, 'version') ?? (await fetchRokuOs());
  const issuesPath = flagValue(argv, 'issues');
  const issues = issuesPath ? JSON.parse(readFileSync(issuesPath, 'utf8')) : [];
  const decision = decideRokuOs({ version, issues });
  const bodyOut = flagValue(argv, 'body-out');
  if (bodyOut) writeFileSync(bodyOut, renderRokuOsBody(decision));
  process.stdout.write(JSON.stringify(decision) + '\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`roku-os-watch: ${err.message}`);
    process.exit(1);
  });
}
