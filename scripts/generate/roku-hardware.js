/**
 * The Roku device dictionary — Roku's published hardware table, parsed into data we
 * own, so nothing in this repo ever has to look a device up by hand again.
 *
 *   npm run roku-hardware:fetch    pull upstream, re-derive, rewrite the dataset
 *   npm run roku-hardware:check    validate the committed dataset (offline)
 *
 * ## Why a dataset and not a hand-typed table
 *
 * This started as 38 lines of object literal in `measurement-guard.js`, typed by hand
 * off the spec. It was accurate — every entry checked out against upstream — and it
 * was still wrong in the way hand-typed tables are always wrong: **incomplete in a
 * direction nobody would notice.** It keyed on `/^(\d{4})/`, so all sixteen
 * letter-prefixed Roku TV and Projector families (`J000X`, `A000X`, `K8PXX`, …)
 * resolved to `null` forever, spanning 512 MB to 2 GB. Roku TVs are the largest device
 * class there is.
 *
 * And upstream moves. In the three months before this was written, `hardware.md` took
 * four commits: one pure SEO/frontmatter edit, one that rewrote an HDR column, one
 * that added the entire legacy table — and one, `0cddfa29`, that **added a new
 * supported device** (`K000X`, Roku TV "Roxton", 512 MB, 2024). Nothing in this repo
 * would ever have known.
 *
 * ## What is normalized, and why the parser REFUSES rather than shrugs
 *
 * The upstream table is prose written by many hands over a decade. The same fact is
 * spelled several ways in the same column:
 *
 * - RAM: `512 MB` twenty-four times, `512MB` once.
 * - Max UI resolution: `1080p`, `1080p/60fps`, and `1920X1080` all mean 1080p.
 * - Max playback: `4K60fps, HDR`, `4K UHD, 60fps`, `3840x2160`, `3840X2160` and
 *   `3,840 x 2,160` all mean 4K — and `1920x1080, 60fps3***` carries a footnote digit
 *   glued to the frame rate, which a naive `parseInt` reads as 603 fps.
 * - HDR support: fifteen distinct spellings of four formats, including `HDR 10`,
 *   `DolbyVision`, `Dolby Vision IQ` and `HDR10+ Adaptive`.
 *
 * So every messy column is parsed to an enum or a number, and **an unrecognized value
 * is a hard failure, never a null.** That is the whole safety property: upstream
 * inventing a spelling (or an 8K playback row, which does not exist today) fails the
 * scheduled sync loudly instead of silently dropping a device into unknown-tier. A
 * dataset that degrades quietly is the hand-typed table with extra steps.
 *
 * Raw cells are deliberately NOT kept beside the normalized values. They would double
 * the file and reintroduce exactly the noise this design removes: a footnote marker
 * moving from `**` to `***` is not a hardware change, and must not open a PR.
 *
 * ## Three levels, because neither a family NOR a model number is one device
 *
 * `3820X` and `3820X2` are both Streaming Stick 4K and both 1 GB, but they are
 * different rows — code name Madison vs Logan, released 2021 vs 2022. So a family is
 * not a device. Less obviously, **a model number is not one either**: upstream lists
 * `8000X` twice (Roku TV "Midland" 2019, and Roku TV (Brazil) "El Paso" 2020, with
 * different playback resolutions) and `4800X` twice (Roku Ultra LT "Benjamin-W" and
 * Roku Ultra "Benjamin"). A device reporting `8000X` over ECP could be either, and no
 * amount of wanting a flat table changes that. Both were found by this parser refusing
 * to overwrite a key, which is the case for refusing rather than shrugging.
 *
 * - **`models`** is keyed by the exact `roDeviceInfo.GetModel()` value. The fields
 *   that are ASSERTED equal across its variants — RAM and support tier — sit at the
 *   top; everything that genuinely differs lives in `variants[]`. So `ramTier` is
 *   always answerable and `name` is honestly plural.
 * - **`families`** is the four-character prefix, carrying ONLY RAM. It exists because
 *   real devices report model numbers that appear in no Roku table at all — the Stick
 *   4K on this LAN reports `3820RW` — and a family hit is the honest fallback.
 *   `deviceFor()` says which level matched.
 *
 * Both invariances are checked, never assumed: `assertInvariants` fails if a family
 * carries two RAM sizes, or if one model number's variants disagree about RAM or tier.
 * They hold across all 79 model numbers in 70 families today.
 *
 * ## `--check` is a tamper gate, not a drift gate
 *
 * Drift against upstream is caught by `.github/workflows/roku-hardware-sync.yml`,
 * which re-derives weekly and opens a PR only when the DATA changes. `--check` runs
 * offline in `npm run lint` and pre-push, and answers a different question: is the
 * committed dataset internally coherent and unedited? It re-validates every invariant
 * and recomputes `_checksum` over the normalized data, so a hand-edit fails at once
 * rather than surviving until the next sync.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the dataset lives, relative to the repo root. */
export const OUTPUT_REL = path.join('scripts', 'data', 'roku-hardware.json');

/**
 * Upstream. `v2.0` is `rokudev/dev-doc`'s DEFAULT branch, not a pinned historical
 * ref — verified at authoring time — so `--fetch` resolves the default branch and
 * asserts it still has this name. A future v3.0 cut then fails the sync loudly
 * instead of silently pinning us to an abandoned ref, which is the failure mode of
 * every hardcoded ref that ever went stale.
 */
export const UPSTREAM = Object.freeze({
  repo: 'rokudev/dev-doc',
  path: 'docs/SPECIFICATIONS/hardware.md',
  ref: 'v2.0',
});

/** Which upstream table a row came from, and what it means for JellyRock. */
export const SUPPORT_TIERS = Object.freeze({
  /** Currently manufactured and supported. */
  CURRENT: 'current',
  /** No longer manufactured, but runs the latest Roku OS. */
  UPDATABLE: 'updatable',
  /** Discontinued, capped at an old Roku OS, and CANNOT run IDK apps — so it cannot
   *  run JellyRock. Kept in the dataset so a consumer can say that, rather than
   *  reporting an unknown device. */
  LEGACY: 'legacy',
});

/** Every screen resolution the table describes, however it spells them. */
export const RESOLUTIONS = Object.freeze(['720p', '1080p', '4K']);

/** Every HDR format the table names, however it spells them. */
export const HDR_FORMATS = Object.freeze(['HDR10', 'HDR10+', 'HLG', 'DolbyVision']);

// ── Cell normalizers ─────────────────────────────────────────────────────────
// Each throws on a value it does not recognize. See the header: a null here would
// be a device silently degrading, which is what the hand-typed table did.

class SpecParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpecParseError';
  }
}

/** `512 MB` / `512MB` / `1 GB` / `1.5 GB` -> megabytes. */
export function parseRam(cell) {
  const m = /^([\d.]+)\s*(MB|GB)$/i.exec(String(cell).trim());
  if (!m) throw new SpecParseError(`unrecognized RAM cell ${JSON.stringify(cell)}`);
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new SpecParseError(`unrecognized RAM amount ${JSON.stringify(cell)}`);
  }
  return m[2].toUpperCase() === 'GB' ? Math.round(value * 1024) : Math.round(value);
}

/**
 * Megabytes -> the tier LABEL, in the exact spelling already written into
 * `.device-runs/measure/measurements.jsonl`.
 *
 * Not cosmetic: real measurement records carry `ramTier: "1GB"`, and tier 3 compares
 * arms on that string. Changing the spelling would silently make every recorded line
 * incomparable with every new one.
 */
export function ramTierLabel(mb) {
  if (mb % 1024 === 0) return `${mb / 1024}GB`;
  if (mb > 1024) return `${Number((mb / 1024).toFixed(1))}GB`;
  return `${mb}MB`;
}

/**
 * A resolution cell -> `{ resolution, fps, hdr }`.
 *
 * Handles every spelling in the table: `720p`, `1080p/60fps`, `1920X1080`,
 * `1280X720`, `4K60fps, HDR`, `4K UHD, 60fps`, `3840x2160`, `3,840 x 2,160`,
 * `4K144fps, HDR`, and the footnote-suffixed `1920x1080, 60fps3***`.
 */
export function parseResolution(cell) {
  // Footnote markers and the digit some rows glue to them (`60fps3***`) are dropped
  // BEFORE any number is read — `parseInt` on `60fps3` would otherwise be plausible
  // and wrong. Commas go too: one row writes `3,840 x 2,160`.
  const text = String(cell).replace(/\*+/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();
  if (!text || /^n\/a$/i.test(text)) return null;

  const fpsMatch = /(\d+)\s*fps/i.exec(text);
  // `60fps3` -> the footnote digit was already stripped above, so this is safe.
  const fps = fpsMatch ? Number(fpsMatch[1]) : null;
  const hdr = /\bhdr\b/i.test(text);

  let resolution = null;
  // `\b4k` and not `\b4k\b`: the commonest spelling is `4K60fps, HDR`, where `K` and
  // `6` are both word characters, so a trailing boundary never matches.
  if (/\b4k/i.test(text) || /\b3840\s*[x×]\s*2160\b/i.test(text)) resolution = '4K';
  else if (/\b1080p?\b/i.test(text) || /\b1920\s*[x×]\s*1080\b/i.test(text)) resolution = '1080p';
  else if (/\b720p?\b/i.test(text) || /\b1280\s*[x×]\s*720\b/i.test(text)) resolution = '720p';

  if (!resolution) {
    throw new SpecParseError(
      `unrecognized resolution cell ${JSON.stringify(cell)} — add it to parseResolution rather ` +
        'than letting a device resolve to null.',
    );
  }
  return { resolution, fps, hdr };
}

/**
 * An HDR-support cell -> `{ formats, variesByModel }`.
 *
 * Fifteen spellings collapse to four formats. `HDR10+ Adaptive` is HDR10+;
 * `Dolby Vision IQ` is Dolby Vision; `HDR 10` (with the space) is HDR10. The
 * `varies by model` qualifier is kept as its own flag rather than thrown away —
 * for a Roku TV it is the difference between "this panel does Dolby Vision" and
 * "some panels in this family do".
 */
export function parseHdr(cell) {
  const text = String(cell).trim();
  if (!text || /^(n\/a|no|none)$/i.test(text)) return { formats: [], variesByModel: false };

  const formats = new Set();
  // Order matters: `HDR10/10+` must contribute BOTH, and the `+` variants must be
  // detected before the bare `HDR10` test would swallow them.
  if (/hdr\s*10\s*\/\s*10\+/i.test(text)) {
    formats.add('HDR10');
    formats.add('HDR10+');
  }
  if (/hdr\s*10\+/i.test(text)) formats.add('HDR10+');
  if (/hdr\s*10\b/i.test(text)) formats.add('HDR10');
  if (/\bhlg\b/i.test(text)) formats.add('HLG');
  if (/dolby\s*vision/i.test(text)) formats.add('DolbyVision');

  if (!formats.size) {
    throw new SpecParseError(
      `unrecognized HDR cell ${JSON.stringify(cell)} — it names no known format and is not ` +
        'one of the "no HDR" spellings. Add it to parseHdr rather than recording an empty set.',
    );
  }
  return {
    // Emitted in HDR_FORMATS order so the JSON is stable regardless of cell wording —
    // otherwise a reworded upstream cell would reorder the array and open a PR that
    // changes nothing.
    formats: HDR_FORMATS.filter((f) => formats.has(f)),
    variesByModel: /varies by model/i.test(text),
  };
}

/**
 * A CPU cell -> its instruction-set family, the one part that is cleanly derivable.
 *
 * The rest of the cell is genuinely free text of varying completeness (`ARM` alone in
 * two rows, `ARM Cortex A53 quad core 1.2 GHz` in others), so core count and clock are
 * NOT parsed: they would be null more often than not, and a mostly-null field reads as
 * missing data rather than as absent upstream. The verbatim cell is kept as `cpu`.
 */
export function parseCpuArch(cell) {
  const text = String(cell).trim();
  // No trailing `\b`: the table writes `ARM11 600 MHz`, where `M` and `1` are both
  // word characters. Same shape as `4K60fps` in `parseResolution` — this document
  // glues numbers onto names in several columns.
  if (/^arm/i.test(text)) return 'ARM';
  if (/^mips/i.test(text)) return 'MIPS';
  throw new SpecParseError(`unrecognized CPU architecture in ${JSON.stringify(cell)}`);
}

/** `OpenGL ES 2.0` / `n/a` -> the API string or null. */
export function parseGraphicsApi(cell) {
  const text = String(cell ?? '').trim();
  if (!text || /^n\/a$/i.test(text)) return null;
  if (/^opengl es [\d.]+$/i.test(text)) return text;
  throw new SpecParseError(`unrecognized graphics API ${JSON.stringify(cell)}`);
}

// ── Table parsing ────────────────────────────────────────────────────────────

/**
 * Every markdown table in the document, as `{ columns, rows }` with rows keyed by
 * column HEADER.
 *
 * Header-keyed rather than positional, and that is load-bearing rather than tidy: the
 * three tables have different column sets (the legacy one has no graphics, resolution
 * or HDR columns at all), and a positional read of the current table finds `1920X1080`
 * in the Max-UI-Resolution column and takes it for a model number, because it matches
 * the shape of one. That mistake was made during review of this very dataset.
 */
export function parseTables(markdown) {
  const tables = [];
  let current = null;
  // Everything since the previous table ended. Carried per table rather than
  // recovered afterwards by searching the document for the table's own text: the
  // header rows are space-padded to their column widths, so a reconstructed
  // `| a | b |` marker never matches what is actually on the line — the first cut of
  // this function looked it up that way and found nothing, which is the failure mode
  // of every "find my own text again" search.
  let preceding = [];
  for (const line of String(markdown).split('\n')) {
    if (!line.trim().startsWith('|')) {
      if (current) preceding = [];
      current = null;
      preceding.push(line);
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the alignment row
    if (!current) {
      current = { columns: cells, rows: [], precedingText: preceding.join('\n') };
      tables.push(current);
      continue;
    }
    const row = {};
    current.columns.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });
    current.rows.push(row);
  }
  return tables;
}

/** Column header -> what we call it. The spec's own spellings, including its casing drift. */
const COLUMN = Object.freeze({
  name: ['Device Name'],
  codeName: ['Code Name', 'Code name'],
  models: ['roDeviceInfo.GetModel()'],
  cpu: ['CPU'],
  graphicsApi: ['Accelerated Graphics API'],
  ram: ['RAM'],
  maxUi: ['Max UI Resolution'],
  maxPlayback: ['Max Playback Resolution'],
  hdr: ['HDR Support'],
  yearReleased: ['Year Released'],
  latestRokuOs: ['Latest Roku OS version'],
});

const cell = (row, key) => {
  for (const header of COLUMN[key]) if (header in row) return row[header];
  return undefined;
};

/**
 * Which support tier a table describes, from the prose heading that precedes it.
 *
 * Read from the document rather than from table order, because table order is an
 * upstream editorial choice and the legacy table was APPENDED (commit `6673df02`)
 * after this document had already existed for months.
 */
export function tierForTable(table) {
  const before = String(table?.precedingText ?? '');
  if (/currently being manufactured/i.test(before)) return SUPPORT_TIERS.CURRENT;
  if (/no longer manufactured/i.test(before)) return SUPPORT_TIERS.UPDATABLE;
  if (/have been discontinued/i.test(before)) return SUPPORT_TIERS.LEGACY;
  return null;
}

/**
 * Markdown -> the normalized dataset (without provenance or checksum).
 *
 * @throws {SpecParseError} on any table, column or cell it does not recognize. See
 *   the header: failing the sync beats emitting a device with a null tier.
 */
export function buildDataset(markdown) {
  const tables = parseTables(markdown).filter((t) => cell(t.rows[0] ?? {}, 'models') !== undefined);
  if (!tables.length) {
    throw new SpecParseError(
      'no table with a `roDeviceInfo.GetModel()` column — upstream restructured the document.',
    );
  }

  const models = {};
  for (const table of tables) {
    const supportTier = tierForTable(table);
    if (!supportTier) {
      throw new SpecParseError(
        `a device table has no recognizable support-tier heading above it (columns: ${table.columns.join(', ')})`,
      );
    }
    if (!table.rows.length) {
      throw new SpecParseError(`the ${supportTier} device table has no rows`);
    }
    for (const row of table.rows) {
      const ramMb = parseRam(cell(row, 'ram'));
      const hdr = cell(row, 'hdr') === undefined ? null : parseHdr(cell(row, 'hdr'));
      const year = cell(row, 'yearReleased');
      const variant = {
        name: cell(row, 'name'),
        codeName: cell(row, 'codeName') || null,
        cpu: cell(row, 'cpu'),
        cpuArch: parseCpuArch(cell(row, 'cpu')),
        graphicsApi:
          cell(row, 'graphicsApi') === undefined
            ? null
            : parseGraphicsApi(cell(row, 'graphicsApi')),
        maxUi: cell(row, 'maxUi') === undefined ? null : parseResolution(cell(row, 'maxUi')),
        maxPlayback:
          cell(row, 'maxPlayback') === undefined ? null : parseResolution(cell(row, 'maxPlayback')),
        hdrFormats: hdr ? hdr.formats : null,
        hdrVariesByModel: hdr ? hdr.variesByModel : null,
        yearReleased: year === undefined || year === '' ? null : Number(year),
        latestRokuOs: cell(row, 'latestRokuOs') || null,
      };
      if (variant.yearReleased !== null && !Number.isInteger(variant.yearReleased)) {
        throw new SpecParseError(`unrecognized year ${JSON.stringify(year)} for ${variant.name}`);
      }
      // One cell can list several model numbers (`2050X, 2050N`, `3930X, 3930EU`).
      // Each becomes its own key: they are distinct values of `GetModel()`, and a
      // device reports exactly one.
      const listed = String(cell(row, 'models'))
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      if (!listed.length) {
        throw new SpecParseError(`a ${supportTier} row lists no model number (${variant.name})`);
      }
      for (const model of listed) {
        // A REPEATED model number is upstream reality, not an error — see the header.
        // The fields hoisted above `variants` must agree across them, and that is
        // asserted rather than assumed: `assertInvariants` fails if two variants of
        // one model number disagree about RAM or support tier, which is the only way
        // the hoist could quietly start lying.
        const existing = models[model];
        if (existing) {
          existing.variants.push(variant);
          continue;
        }
        models[model] = {
          family: familyOf(model),
          ramMb,
          ramTier: ramTierLabel(ramMb),
          supportTier,
          variants: [variant],
        };
      }
      // Recorded per model so the invariant check below has both sides to compare.
      for (const model of listed) {
        models[model].__seen = models[model].__seen || [];
        models[model].__seen.push({ ramMb, supportTier, name: variant.name });
      }
    }
  }

  // The hoisted fields, verified against every row that contributed to them. Done
  // here rather than only in `assertInvariants` so `--fetch` fails on the offending
  // upstream row by NAME, which is what a person fixing it needs.
  for (const [model, entry] of Object.entries(models)) {
    for (const seen of entry.__seen) {
      if (seen.ramMb !== entry.ramMb) {
        throw new SpecParseError(
          `model ${model} is listed with two RAM sizes upstream (${entry.ramMb} MB and ` +
            `${seen.ramMb} MB, the latter for ${seen.name}) — RAM can no longer be hoisted to ` +
            'the model number.',
        );
      }
      if (seen.supportTier !== entry.supportTier) {
        throw new SpecParseError(
          `model ${model} appears in two support tiers upstream (${entry.supportTier} and ` +
            `${seen.supportTier}, the latter for ${seen.name}).`,
        );
      }
    }
    delete entry.__seen;
  }

  return { models: sortKeys(models), families: buildFamilies(models) };
}

/**
 * The lookup key for a model number: its first four characters.
 *
 * Four, not `/^\d{4}/`. The digits-only key silently excluded every Roku TV and the
 * Projector — `J000X`, `A000X`, `C000GB`, `K8PXX` — thirteen currently-supported
 * families spanning 512 MB to 2 GB. Checked against the whole published table before
 * adopting it: 70 families, none carrying two RAM values, and `assertInvariants`
 * re-checks that on every generate and every `--check` rather than trusting it.
 */
export const familyOf = (model) => String(model).slice(0, 4).toUpperCase();

/**
 * Families carry ONLY what is invariant across their members.
 *
 * RAM is; almost nothing else is. `3820X` and `3820X2` are one family and one RAM
 * size, but different code names (Madison, Logan) and different release years (2021,
 * 2022) — so a family cannot answer "what device is this", only "how much memory does
 * it have". That is exactly the question the measurement guard asks, and pretending to
 * more would be the hand-typed table's mistake in a new costume.
 */
function buildFamilies(models) {
  const families = {};
  for (const [model, entry] of Object.entries(models)) {
    const key = entry.family;
    if (!families[key]) {
      families[key] = { models: [], ramMb: entry.ramMb, ramTier: entry.ramTier, supportTiers: [] };
    }
    families[key].models.push(model);
    if (!families[key].supportTiers.includes(entry.supportTier)) {
      families[key].supportTiers.push(entry.supportTier);
    }
  }
  for (const f of Object.values(families)) {
    f.models.sort();
    f.supportTiers.sort();
  }
  return sortKeys(families);
}

const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// ── Invariants ───────────────────────────────────────────────────────────────

/**
 * Everything the dataset's shape promises, asserted.
 *
 * This is the real version of a test that used to read
 * `expect(new Set(Object.keys(TABLE)).size).toBe(Object.keys(TABLE).length)` — which
 * can never fail, because object keys cannot repeat. Its stated purpose was to check
 * the assumption family-keying rests on. That claim is about the published table, and
 * only a check against the parsed table can make it.
 *
 * Runs at generate time AND in `--check`, so upstream can never introduce a violation
 * without failing the sync.
 *
 * @returns {string[]} problems, empty when the dataset is coherent.
 */
export function assertInvariants(dataset) {
  const problems = [];
  const models = dataset?.models ?? {};
  const families = dataset?.families ?? {};
  const tiers = new Set(Object.values(SUPPORT_TIERS));

  if (!Object.keys(models).length) problems.push('the dataset has no models');

  for (const [model, entry] of Object.entries(models)) {
    const where = `model ${model}`;
    if (entry.family !== familyOf(model)) {
      problems.push(`${where}: family ${entry.family} is not its own first four characters`);
    }
    if (!families[entry.family]) problems.push(`${where}: family ${entry.family} is not indexed`);
    if (!tiers.has(entry.supportTier)) {
      problems.push(`${where}: unknown supportTier ${JSON.stringify(entry.supportTier)}`);
    }
    if (!Number.isInteger(entry.ramMb) || entry.ramMb <= 0) {
      problems.push(`${where}: ramMb is not a positive integer`);
    } else if (entry.ramTier !== ramTierLabel(entry.ramMb)) {
      problems.push(`${where}: ramTier ${entry.ramTier} disagrees with ramMb ${entry.ramMb}`);
    }
    if (!Array.isArray(entry.variants) || !entry.variants.length) {
      problems.push(`${where}: no variants`);
      continue;
    }
    entry.variants.forEach((variant, i) => {
      const at = `${where} variant ${i} (${variant.name || 'unnamed'})`;
      if (!variant.name) problems.push(`${at}: no device name`);
      if (variant.cpuArch !== 'ARM' && variant.cpuArch !== 'MIPS') {
        problems.push(`${at}: unknown cpuArch ${JSON.stringify(variant.cpuArch)}`);
      }
      for (const key of ['maxUi', 'maxPlayback']) {
        const value = variant[key];
        if (value === null || value === undefined) continue;
        if (!RESOLUTIONS.includes(value.resolution)) {
          problems.push(
            `${at}: ${key} resolution ${JSON.stringify(value.resolution)} is not an enum member`,
          );
        }
        if (value.fps !== null && !Number.isInteger(value.fps)) {
          problems.push(`${at}: ${key} fps is neither null nor an integer`);
        }
      }
      for (const f of variant.hdrFormats ?? []) {
        if (!HDR_FORMATS.includes(f)) {
          problems.push(`${at}: HDR format ${JSON.stringify(f)} is not an enum member`);
        }
      }
      if (variant.yearReleased !== null && !Number.isInteger(variant.yearReleased)) {
        problems.push(`${at}: yearReleased is neither null nor an integer`);
      }
    });
  }

  for (const [key, family] of Object.entries(families)) {
    if (key !== key.slice(0, 4).toUpperCase() || key.length !== 4) {
      problems.push(`family ${key}: not a four-character upper-case key`);
    }
    for (const model of family.models) {
      if (!models[model]) problems.push(`family ${key}: lists unknown model ${model}`);
      else if (models[model].family !== key) {
        problems.push(`family ${key}: model ${model} belongs to ${models[model].family}`);
      }
    }
    // THE assumption family-keying rests on. If Roku ever ships a 2 GB revision under
    // an existing family prefix, this is what says so — loudly, at sync time, instead
    // of quietly mislabelling a comparison arm.
    const rams = [...new Set(family.models.map((m) => models[m]?.ramMb))];
    if (rams.length > 1) {
      problems.push(
        `family ${key} carries ${rams.length} different RAM sizes (${rams.join(', ')} MB) across ` +
          `${family.models.join(', ')} — the four-character family key is no longer a safe ` +
          'lookup and `familyOf` must be revisited.',
      );
    }
    if (family.ramMb !== rams[0]) {
      problems.push(`family ${key}: indexed ramMb ${family.ramMb} disagrees with its members`);
    }
  }

  const indexed = new Set(Object.values(families).flatMap((f) => f.models));
  for (const model of Object.keys(models)) {
    if (!indexed.has(model)) problems.push(`model ${model} is in no family`);
  }
  return problems;
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * A stable hash over the DATA only — never over provenance.
 *
 * Provenance changes on every fetch (`fetchedAt`, and the blob SHA whenever upstream
 * edits prose). Hashing it would make the checksum change when nothing about any
 * device did, which is the noise this whole design exists to suppress.
 */
export function checksum(dataset) {
  return createHash('sha256')
    .update(JSON.stringify({ models: dataset.models, families: dataset.families }))
    .digest('hex')
    .slice(0, 16);
}

const serialize = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

/** Read the committed dataset. Returns null when it is absent or unparseable. */
export function readDataset(file = path.join(rootDir, OUTPUT_REL)) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ── Upstream ─────────────────────────────────────────────────────────────────

const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();

/**
 * Pull the spec, and everything needed to point at the exact bytes it came from.
 *
 * Asserts the tracked ref is still the repository default. `v2.0` is the default
 * today; if Roku cuts a v3.0 and moves it, this fails rather than continuing to
 * report a frozen table as current — which is the specific way a pinned ref goes bad
 * without anyone noticing.
 */
export function fetchUpstream() {
  const defaultBranch = gh(['api', `repos/${UPSTREAM.repo}`, '--jq', '.default_branch']);
  if (defaultBranch !== UPSTREAM.ref) {
    throw new SpecParseError(
      `${UPSTREAM.repo}'s default branch is now ${JSON.stringify(defaultBranch)}, not ` +
        `${JSON.stringify(UPSTREAM.ref)}. The tracked ref is stale — update UPSTREAM.ref after ` +
        'checking whether the table moved with it.',
    );
  }
  const meta = JSON.parse(
    gh([
      'api',
      `repos/${UPSTREAM.repo}/contents/${UPSTREAM.path}?ref=${UPSTREAM.ref}`,
      '--jq',
      '{sha: .sha, content: .content}',
    ]),
  );
  const commit = JSON.parse(
    gh([
      'api',
      `repos/${UPSTREAM.repo}/commits?path=${UPSTREAM.path}&sha=${UPSTREAM.ref}&per_page=1`,
      '--jq',
      '.[0] | {sha: .sha, date: .commit.committer.date}',
    ]),
  );
  return {
    markdown: Buffer.from(meta.content, 'base64').toString('utf8'),
    blobSha: meta.sha,
    upstreamCommit: commit.sha,
    upstreamCommittedAt: commit.date,
  };
}

/** Assemble the committed document from a fetch. `fetchedAt` is passed in, for tests. */
export function buildDocument(upstream, { fetchedAt } = {}) {
  const dataset = buildDataset(upstream.markdown);
  const problems = assertInvariants(dataset);
  if (problems.length) {
    throw new SpecParseError(
      `upstream violates the dataset's invariants:\n  - ${problems.join('\n  - ')}`,
    );
  }
  return {
    _comment:
      'GENERATED — do not edit. Roku hardware specifications, normalized. ' +
      'Regenerate with `npm run roku-hardware:fetch`; validate with `npm run roku-hardware:check`.',
    _provenance: {
      source: UPSTREAM.repo,
      path: UPSTREAM.path,
      ref: UPSTREAM.ref,
      blobSha: upstream.blobSha,
      upstreamCommit: upstream.upstreamCommit,
      upstreamCommittedAt: upstream.upstreamCommittedAt,
      fetchedAt: fetchedAt ?? new Date().toISOString().slice(0, 10),
      generator: 'scripts/generate/roku-hardware.js',
    },
    _checksum: checksum(dataset),
    enums: {
      resolution: [...RESOLUTIONS],
      hdrFormat: [...HDR_FORMATS],
      supportTier: Object.values(SUPPORT_TIERS),
    },
    ...dataset,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = [
  'Usage:',
  '  node scripts/generate/roku-hardware.js --fetch    pull upstream and rewrite the dataset',
  '  node scripts/generate/roku-hardware.js --check    validate the committed dataset (offline)',
].join('\n');

/** `--check`: invariants plus the tamper checksum. Never touches the network. */
export function checkCommitted(file = path.join(rootDir, OUTPUT_REL)) {
  const doc = readDataset(file);
  if (!doc)
    return [`${OUTPUT_REL} is missing or is not valid JSON — run \`npm run roku-hardware:fetch\`.`];
  const problems = assertInvariants(doc);
  const expected = checksum(doc);
  if (doc._checksum !== expected) {
    problems.push(
      `checksum ${doc._checksum} does not match the data (${expected}) — the dataset was edited ` +
        'by hand. It is generated: change `scripts/generate/roku-hardware.js` or re-run ' +
        '`npm run roku-hardware:fetch`.',
    );
  }
  return problems;
}

function main(argv) {
  const check = argv.includes('--check');
  const fetch = argv.includes('--fetch');
  if (check === fetch) {
    console.error(`roku-hardware: pass exactly one of --fetch or --check.\n\n${USAGE}`);
    process.exit(1);
  }

  if (check) {
    const problems = checkCommitted();
    if (problems.length) {
      console.error(`roku-hardware:check FAILED\n  - ${problems.join('\n  - ')}`);
      process.exit(1);
    }
    const doc = readDataset();
    console.log(
      `roku-hardware:check: ${Object.keys(doc.models).length} models in ` +
        `${Object.keys(doc.families).length} families, checksum ${doc._checksum} — OK.`,
    );
    return;
  }

  let doc;
  try {
    doc = buildDocument(fetchUpstream());
  } catch (e) {
    console.error(`roku-hardware:fetch FAILED — ${e.message}`);
    process.exit(1);
  }
  const outPath = path.join(rootDir, OUTPUT_REL);
  const before = readDataset(outPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialize(doc), 'utf8');
  const changed = before?._checksum !== doc._checksum;
  console.log(
    `roku-hardware:fetch: wrote ${OUTPUT_REL} — ${Object.keys(doc.models).length} models in ` +
      `${Object.keys(doc.families).length} families. Data ${changed ? 'CHANGED' : 'unchanged'} ` +
      `(checksum ${doc._checksum}).`,
  );
  // The sync workflow reads this to decide whether to open a PR: provenance moves on
  // every fetch, so "the file is dirty" is not the same question as "a device changed".
  console.log(`roku-hardware:data-changed=${changed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
