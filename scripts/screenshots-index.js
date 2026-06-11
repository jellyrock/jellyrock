/**
 * scripts/screenshots-index.js — generate docs/screenshots/README.md, the index
 * GitHub renders when you open the folder. Two parts, both derived (never
 * hardcoded) from the captured files + the manifest:
 *   1. a language switcher — every captured language as a native-name link to its
 *      folder (collapsed behind a <details> once the set grows large, since the
 *      capture matrix is planned to reach ~99 locales);
 *   2. a screen gallery — each screen shown once (from the en_US set) as a labelled
 *      thumbnail, grouped into sections, so the index showcases the breadth of the
 *      app without repeating a near-identical image per language.
 *
 * Regenerated alongside the screenshots (called by scripts/capture-screenshots.js)
 * and runnable standalone: `npm run screenshots:index`. The output is generated —
 * DO NOT hand-edit it; change this generator instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(repoRoot, 'docs', 'screenshots');
const languagesJson = path.join(repoRoot, 'locale', 'languages.json');
const manifestJson = path.join(shotsDir, 'screenshots.json');

// Ordered gallery sections. A screen is placed in the first section that lists it;
// any captured screen not listed here falls into a trailing "More" section, so new
// screens still appear (just regroup them here when convenient).
const SECTIONS = [
  { title: 'Getting started', names: ['serverSelect', 'userSelect', 'home', 'settings', 'search'] },
  // Playback sits high up — the OSD is a highlight, not something to bury at the bottom.
  { title: 'Playback', names: ['osd', 'trickplay'] },
  {
    title: 'Libraries & views',
    names: [
      'libraryGrid',
      'moviesLibraryGrid',
      'moviesLibraryStudios',
      'moviesLibraryGenres',
      'tvLibraryShows',
      'tvLibraryNetworks',
      'tvLibraryGenres',
      'musicLibraryAlbumArtists',
      'musicLibraryAlbums',
      'musicLibraryArtists',
      'musicLibraryGenres',
      'playlistsLibrary',
      'libraryOptions',
    ],
  },
  {
    title: 'Item details',
    names: [
      'movieDetails',
      'seriesDetails',
      'seasonDetails',
      'episodeDetails',
      'musicAlbumDetails',
      'musicArtistDetails',
      'audioDetails',
      'playlistDetails',
      'personDetails',
    ],
  },
];

const GALLERY_COLS = 3;
const COLLAPSE_LANGUAGES_OVER = 12; // wrap the language list in <details> past this

/** camelCase screen name -> human label (osd -> OSD, tv -> TV). */
function humanize(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((w) => {
      const lw = w.toLowerCase();
      if (lw === 'osd') return 'OSD';
      if (lw === 'tv') return 'TV';
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function generateIndex() {
  const nativeByCode = Object.fromEntries(
    JSON.parse(fs.readFileSync(languagesJson, 'utf8')).map((l) => [l.code, l.nativeName]),
  );
  const nativeName = (code) => nativeByCode[code] || code;

  // Captured locales = subfolders that actually contain a screenshot.
  const captured = fs
    .readdirSync(shotsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.readdirSync(path.join(shotsDir, name)).some((f) => f.endsWith('.png')))
    .sort((a, b) => nativeName(a).localeCompare(nativeName(b)));

  // Screen order: the manifest's `screens` if present, else whatever en_US holds.
  const galleryLang = captured.includes('en_US') ? 'en_US' : captured[0];
  let screens = [];
  if (fs.existsSync(manifestJson)) {
    screens = JSON.parse(fs.readFileSync(manifestJson, 'utf8')).screens || [];
  }
  const hasShot = (name) =>
    galleryLang && fs.existsSync(path.join(shotsDir, galleryLang, `${name}.png`));
  screens = screens.filter(hasShot);

  // Group screens into sections (manifest order within each section), with a
  // trailing "More" bucket for any captured screen not assigned above.
  const assigned = new Set();
  const sections = SECTIONS.map((s) => {
    const names = s.names.filter((n) => screens.includes(n));
    names.forEach((n) => assigned.add(n));
    return { title: s.title, names };
  }).filter((s) => s.names.length);
  const leftover = screens.filter((n) => !assigned.has(n));
  if (leftover.length) sections.push({ title: 'More', names: leftover });

  const langLink = (code) => `[${nativeName(code)}](${code}/)`;
  const cell = (name) =>
    `<a href="${galleryLang}/${name}.png"><img src="${galleryLang}/${name}.png" width="260" alt="${humanize(name)}"></a><br>${humanize(name)}`;

  // Raw HTML <table> (not a markdown table): markdown tables force a header row,
  // which renders as an empty band above each section. HTML needs no header, so the
  // grid is just rows of thumbnails with the caption beneath each.
  const galleryTable = (names) => {
    let out = '<table>\n';
    for (let i = 0; i < names.length; i += GALLERY_COLS) {
      out += '  <tr>\n';
      for (const n of names.slice(i, i + GALLERY_COLS)) {
        out += `    <td align="center" valign="top">${cell(n)}</td>\n`;
      }
      out += '  </tr>\n';
    }
    out += '</table>\n';
    return out;
  };

  let md = '<!-- markdownlint-disable -->\n';
  md += '<!--\n';
  md += '  THIS FILE IS AUTO-GENERATED by scripts/screenshots-index.js. DO NOT EDIT BY HAND.\n';
  md += '  Regenerated by `npm run screenshots:index` and every `npm run screenshots:capture`.\n';
  md += '-->\n\n';
  md += '# JellyRock screenshots\n\n';
  md += `A preview of the app, captured on a real Roku in ${captured.length} `;
  md += `${captured.length === 1 ? 'language' : 'languages'}. Each language link below opens a `;
  md += 'folder with the full set of screens in that language.\n\n';

  // Language switcher — every captured language, equal weight. Collapse once large.
  const langs = captured.map(langLink).join(' · ');
  if (captured.length > COLLAPSE_LANGUAGES_OVER) {
    md += `<details>\n<summary><strong>Languages</strong> (${captured.length})</summary>\n\n`;
    md += `${langs}\n\n</details>\n\n`;
  } else {
    md += `**Languages:** ${langs}\n\n`;
  }

  // Screen gallery — each screen once, grouped. Thumbnails come from `galleryLang`.
  for (const section of sections) {
    md += `## ${section.title}\n\n`;
    md += galleryTable(section.names) + '\n';
  }

  const dest = path.join(shotsDir, 'README.md');
  fs.writeFileSync(dest, md);
  return { dest, captured: captured.length, screens: screens.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = generateIndex();
  console.log(
    `wrote ${path.relative(repoRoot, r.dest)} (${r.screens} screens, ${r.captured} languages)`,
  );
}
