/**
 * Look up a Roku device by the model number ECP reports.
 *
 * The read side of `scripts/data/roku-hardware.json` — Roku's published hardware
 * table, normalized and committed by `scripts/generate/roku-hardware.js`. See that
 * file for where the data comes from, what is normalized, and how it stays current.
 *
 * ## Why this is its own module and not part of the measurement guard
 *
 * It began inside `measurement-guard.js`, which imports `roku-test-automation` for
 * ODC. Nothing about "how much memory does a 3820 have" needs a device client, and
 * `measure-compare.js` — a tool that only reads a JSON Lines file — was pulling the
 * whole RTA stack in to resolve one RAM label. A dictionary lookup is a pure
 * function over committed data and belongs where anything can import it cheaply.
 *
 * ## What a lookup can and cannot answer
 *
 * ECP reports `model-number` and nothing about memory, so this table is the only
 * source for a RAM tier. It answers at three levels of confidence, and says which:
 *
 * - **`model`** — the exact `GetModel()` value is in Roku's table. Everything the
 *   spec publishes is available.
 * - **`family`** — it is not, but its four-character prefix is. Real and common:
 *   the Streaming Stick 4K on this LAN reports `3820RW`, which appears in no Roku
 *   table, while `3820X` and `3820X2` do. Only RAM is answerable, because RAM is the
 *   one field asserted invariant across a family (`3820X` and `3820X2` differ in code
 *   name and release year).
 * - **`null`** — neither. Never a guess and never the commonest value: an unknown
 *   device silently reading as 1 GB would let a comparison pair a 512 MB Stick
 *   against an Ultra and print a delta that is entirely hardware.
 */
import { createRequire } from 'node:module';

// `createRequire` rather than an `import … with { type: 'json' }` attribute: this is
// read by ESM scripts, by Vitest and by the BSC-adjacent tooling, and a require of a
// JSON file is the form every one of them has handled for years. The attribute syntax
// is newer than some of that toolchain.
const dataset = createRequire(import.meta.url)('./data/roku-hardware.json');

/** The committed dataset, frozen. Exported for tests and for the generator's check. */
export const ROKU_HARDWARE = Object.freeze(dataset);

/**
 * The lookup key for a model number: its first four characters, upper-cased.
 *
 * Four CHARACTERS, not four digits. A digits-only key excluded every Roku TV and the
 * Projector — `J000X`, `A000X`, `C000GB`, `K8PXX` — sixteen families spanning 512 MB
 * to 2 GB, which is the largest device class Roku ships. Verified unambiguous across
 * the whole published table, and re-verified on every generate and every
 * `roku-hardware:check`: no family carries two RAM sizes.
 */
export const familyOf = (modelNumber) =>
  String(modelNumber ?? '')
    .slice(0, 4)
    .toUpperCase();

/**
 * Everything known about a model number, or `null`.
 *
 * @returns {null | {
 *   matchedBy: 'model' | 'family',
 *   modelNumber: string,
 *   family: string,
 *   ramMb: number,
 *   ramTier: string,
 *   supportTier?: string,
 *   variants?: object[],
 * }} `matchedBy` is the caller's cue for how much to trust the rest: a `family` match
 *   carries RAM and nothing else, because nothing else is invariant across a family.
 */
export function deviceFor(modelNumber) {
  const model = String(modelNumber ?? '').trim();
  if (!model) return null;

  const exact = ROKU_HARDWARE.models[model] ?? ROKU_HARDWARE.models[model.toUpperCase()];
  if (exact) return { matchedBy: 'model', modelNumber: model, ...exact };

  const family = ROKU_HARDWARE.families[familyOf(model)];
  if (!family) return null;
  return {
    matchedBy: 'family',
    modelNumber: model,
    family: familyOf(model),
    ramMb: family.ramMb,
    ramTier: family.ramTier,
  };
}

/**
 * The RAM tier label for a model number, or `null` when it is not in the table.
 *
 * The label's SPELLING is load-bearing rather than cosmetic — `512MB`, `1GB`,
 * `1.5GB`, `2GB`. Measurement records already on disk carry `ramTier: "1GB"`, and
 * tier 3 refuses a comparison whose arms disagree on that string, so a respelling
 * would quietly make every recorded series incomparable with every new one.
 */
export function ramTierFor(modelNumber) {
  return deviceFor(modelNumber)?.ramTier ?? null;
}

/**
 * Every RAM tier the table knows, smallest first.
 *
 * Ordered by `ramMb` out of the SAME rows that assign the labels, rather than by
 * parsing the labels — `512MB` and `1.5GB` do not sort as strings, and a second
 * place that decodes the spelling is the drift the note above exists to prevent.
 * A tier is listed once however many models carry it.
 */
export const RAM_TIERS = Object.freeze(
  [
    ...new Map(
      [...Object.values(ROKU_HARDWARE.models), ...Object.values(ROKU_HARDWARE.families)]
        .filter((d) => d?.ramTier)
        .map((d) => [d.ramTier, d.ramMb ?? Number.POSITIVE_INFINITY]),
    ),
  ]
    .sort((a, b) => a[1] - b[1])
    .map(([tier]) => tier),
);

/**
 * Sort comparator for tier labels — smallest RAM first, unknown labels LAST.
 *
 * Unknown is sorted rather than dropped, and that is the whole reason this is not an
 * `indexOf` at the call site: a report column whose tier the table cannot place is a
 * device nobody has added yet, and the honest output for it is a column at the end,
 * not a silently missing one.
 */
export function compareRamTiers(a, b) {
  const rank = (t) => {
    const i = RAM_TIERS.indexOf(t);
    return i === -1 ? RAM_TIERS.length : i;
  };
  return rank(a) - rank(b) || String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * True when a model number is one JellyRock cannot run on at all.
 *
 * Roku's legacy table is not merely "old": its own heading says those models "cannot
 * be used to run IDK apps". Recorded rather than omitted, so a consumer can say that
 * outright instead of reporting an unknown device — which is a different fact and
 * would send someone looking for a missing table entry that is deliberately present.
 */
export function cannotRunApps(modelNumber) {
  return deviceFor(modelNumber)?.supportTier === 'legacy';
}

/**
 * A one-line human description, for a log or a report line.
 *
 * Names every variant when a model number has more than one — `8000X` is both
 * "Roku TV" and "Roku TV (Brazil)", and `4800X` is both "Roku Ultra LT" and "Roku
 * Ultra". A device reporting one of those could be either, and picking the first
 * silently would be inventing provenance.
 */
export function describeDevice(modelNumber) {
  const device = deviceFor(modelNumber);
  if (!device) return `${modelNumber} (not in Roku's published hardware table)`;
  if (device.matchedBy === 'family') {
    return `${modelNumber} (${device.ramTier}; resolved from family ${device.family} — the exact model number is unlisted)`;
  }
  const names = [...new Set(device.variants.map((v) => v.name))].join(' / ');
  return `${modelNumber} — ${names} (${device.ramTier}, ${device.supportTier})`;
}
