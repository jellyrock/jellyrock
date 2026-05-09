// Adds a new icon to JellyRock by fetching the canonical Material Symbols
// SVG, applying JellyRock's house style (white fill for blendColor tinting),
// writing it to resources/icons/, and appending a row to the README provenance
// table.
//
// Why this exists: JellyRock standardizes on the Material Symbols family
// (Rounded variant, weight 500, 24px, **outlined by default**) for all
// in-app icons. Letting contributors browse icons.google.com and manually
// download SVGs invites drift — wrong variant, wrong weight, missing
// white-fill injection. This script encodes the convention as code so a
// contributor's only choice is "which Material symbol do I want" —
// everything else is locked.
//
// Fill convention: outlined (`fill=0`) is the default — outlined glyphs
// read more clearly at 10-foot UI distance because the silhouette is
// recognizable without color information. Use the `--filled` flag (or
// document a per-icon override in resources/icons/README.md) ONLY when:
//   1. The icon is the "on" state of a toggle paired with an outlined
//      "off" state (e.g. `favorite` outlined / `favorite_selected` filled).
//   2. The glyph is a pure shape with no meaningful outlined variant
//      (e.g. `play` triangle, `pause` bars, `circle`, rating-dot `star`).
//   3. A documented per-icon visual review concluded outlined is illegible
//      at the rendered size (rare; record the rationale inline).
//
// Source-of-truth: google/material-design-icons on GitHub. Path pattern:
//   symbols/web/<material_name>/materialsymbolsrounded/<material_name>_wght500fill1_24px.svg
//
// Usage:
//   node scripts/generate/icons-add.js <material_name> [--as <jellyrock_name>] [--filled]
//
//   <material_name>     Material Symbols name (snake_case), e.g. play_arrow.
//   --as <name>         Save as resources/icons/<name>.svg instead of using
//                       the Material name. Use this to preserve existing
//                       JellyRock callsite names (e.g. play_arrow → play.svg).
//   --filled            Fetch the filled (fill=1) variant instead of the
//                       outlined default. Use ONLY for the documented
//                       exception cases (toggle on-states, pure shapes).
//   --dry-run           Print what would happen without writing any files.
//
// Examples:
//   node scripts/generate/icons-add.js play_arrow --as play --filled
//   node scripts/generate/icons-add.js menu_book --as chapters
//   node scripts/generate/icons-add.js favorite_selected --filled
//
// After running:
//   1. (Optional) Add a glyphSize entry to resources/icons/icons.json if the
//      default 54 doesn't fit visually.
//   2. Run `npm run icons:build` to render the FHD + HD PNGs.
//   3. Update the call site to use `pkg:/images/icons/<name>_$$RES$$.png`.
//   4. Delete the old single-resolution PNG if migrating an existing icon.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SVG_DIR_REL = 'resources/icons';
const README_REL = 'resources/icons/README.md';
const PROVENANCE_TABLE_HEADER =
  '| File | Material Symbols name | Style | Weight | Fill | Size | Downloaded |';

// Locked house-style coordinates (variant + weight + size). If these need to
// change, update them in one place and re-fetch every icon.
const STYLE = 'Rounded';
const WEIGHT = 500;
const SIZE = '24px';
const VARIANT_PATH = 'materialsymbolsrounded';
// Fill defaults to 0 (outlined) per the Fill convention documented at the
// top of this file. The --filled CLI flag opts into fill=1 for the
// documented exception cases.
const FILL_DEFAULT = 0;

// ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  let asName = null;
  let dryRun = false;
  let filled = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--as') {
      asName = args[++i];
      if (!asName) throw new Error('--as requires a name argument');
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--filled') {
      filled = true;
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    throw new Error(
      'Missing required argument: <material_name>\n' +
        'Usage: node scripts/generate/icons-add.js <material_name> [--as <jellyrock_name>] [--filled] [--dry-run]',
    );
  }
  if (positional.length > 1) {
    throw new Error(`Too many positional arguments: ${positional.join(' ')}`);
  }

  return {
    materialName: positional[0],
    jellyRockName: asName ?? positional[0],
    fill: filled ? 1 : FILL_DEFAULT,
    dryRun,
  };
}

function fetchMaterialSvg(materialName, fill) {
  // Material's GitHub repo names files by axis-deviation from defaults:
  //   - fill=0 (default outlined):  <name>_wght500_24px.svg     (no "fill0")
  //   - fill=1 (explicit filled):   <name>_wght500fill1_24px.svg
  // We always pin weight=500, so wght500 is always present. fill suffix only
  // appears when fill !== 0.
  const fillSuffix = fill === 0 ? '' : `fill${fill}`;
  const filename = `${materialName}_wght${WEIGHT}${fillSuffix}_${SIZE}.svg`;
  const ghPath = `repos/google/material-design-icons/contents/symbols/web/${materialName}/${VARIANT_PATH}/${filename}?ref=master`;
  let raw;
  try {
    raw = execFileSync('gh', ['api', ghPath, '--jq', '.content'], { encoding: 'utf8' });
  } catch (err) {
    // Surface helpful guidance, then rethrow so the original gh error +
    // stack trace are preserved.
    console.error(`Failed to fetch '${materialName}' from google/material-design-icons.`);
    console.error(`Tried path: ${ghPath}`);
    console.error(
      `Verify the material name exists at https://fonts.google.com/icons (search for "${materialName}").`,
    );
    throw err;
  }
  const svg = Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (!svg.includes('<svg')) {
    throw new Error(
      `Fetched content is not valid SVG for '${materialName}':\n${svg.slice(0, 200)}`,
    );
  }
  return svg;
}

function injectWhiteFill(svg) {
  // JellyRock components apply blendColor at render time, which performs
  // per-channel multiplication. Black source × any tint = black, so the
  // SVG must ship with white fill for the tint to actually colorize.
  // This regex targets <path d=…> (the only element Material Symbols ships).
  if (svg.includes('fill="')) {
    // Already has a fill attribute — respect it. Contributor may have a
    // reason (e.g. multi-color brand icon).
    return svg;
  }
  return svg.replace(/<path d=/g, '<path fill="#FFFFFF" d=');
}

function appendProvenanceRow(readmePath, jellyRockName, materialName, fill) {
  const today = new Date().toISOString().slice(0, 10);
  const newRow = `| \`${jellyRockName}.svg\` | \`${materialName}\` | ${STYLE} | ${WEIGHT} | ${fill} | \`${SIZE}\` | ${today} |`;

  const readme = readFileSync(readmePath, 'utf8');
  const headerIdx = readme.indexOf(PROVENANCE_TABLE_HEADER);
  if (headerIdx === -1) {
    throw new Error(
      `Provenance table header not found in ${readmePath}.\n` +
        `Expected: ${PROVENANCE_TABLE_HEADER}`,
    );
  }
  // Find the end of the table (next blank line or EOF).
  const lines = readme.split('\n');
  let headerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === PROVENANCE_TABLE_HEADER) {
      headerLine = i;
      break;
    }
  }
  // Skip the header and the |---|---|... separator.
  let lastRow = headerLine + 1;
  while (lastRow + 1 < lines.length && lines[lastRow + 1].startsWith('|')) {
    lastRow++;
  }
  // Check for duplicate rows (idempotent re-run).
  for (let i = headerLine + 2; i <= lastRow; i++) {
    if (lines[i].startsWith(`| \`${jellyRockName}.svg\``)) {
      // Replace the existing row to refresh the date / source.
      lines[i] = newRow;
      return lines.join('\n');
    }
  }
  // Insert as a new row at the end of the table.
  lines.splice(lastRow + 1, 0, newRow);
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    console.error(`icons:add: ${err.message}`);
    process.exit(1);
  }

  const { materialName, jellyRockName, fill, dryRun } = parsed;
  const repoRoot = '.';
  const svgPath = join(repoRoot, SVG_DIR_REL, `${jellyRockName}.svg`);
  const readmePath = join(repoRoot, README_REL);

  if (existsSync(svgPath) && !dryRun) {
    console.error(`icons:add: ${svgPath} already exists. Delete it first if you want to refresh.`);
    process.exit(1);
  }

  let svg;
  try {
    svg = fetchMaterialSvg(materialName, fill);
  } catch (err) {
    console.error(`icons:add: ${err.message}`);
    process.exit(1);
  }

  svg = injectWhiteFill(svg);

  let updatedReadme;
  try {
    updatedReadme = appendProvenanceRow(readmePath, jellyRockName, materialName, fill);
  } catch (err) {
    console.error(`icons:add: ${err.message}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`icons:add: dry-run — would write:`);
    console.log(`  ${svgPath} (${svg.length} bytes, fill=${fill})`);
    console.log(`  ${readmePath} (provenance table updated)`);
    process.exit(0);
  }

  writeFileSync(svgPath, svg);
  writeFileSync(readmePath, updatedReadme);

  console.log(`icons:add: wrote ${svgPath} (fill=${fill})`);
  console.log(`icons:add: appended provenance row to ${readmePath}`);
  console.log(``);
  console.log(`Next steps:`);
  console.log(
    `  1. (Optional) Add glyphSize to resources/icons/icons.json if 54px default doesn't fit.`,
  );
  console.log(`  2. Run 'npm run icons:build' to render the FHD + HD PNGs.`);
  console.log(`  3. Update the call site URI to 'pkg:/images/icons/${jellyRockName}_$$RES$$.png'.`);
  console.log(`  4. If migrating an existing icon, delete the old single-res PNG.`);
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  main();
}

export { parseArgs, injectWhiteFill, appendProvenanceRow };
