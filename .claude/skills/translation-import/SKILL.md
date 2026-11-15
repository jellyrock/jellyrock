---
name: translation-import
description: Import translations for untranslated JellyRock keys from other Jellyfin clients, one reviewed batch at a time. Ranks unmapped keys by the cells mapping them would fill (`npm run translations:seed -- suggest --rank`), judges each candidate's meaning and shape from its key name and its own translations, reads the source's code only when those leave it unclear (`translations:seed -- context`), and writes `locale/seed/keymap.yml` entries, `reject:` lines and `exclude:` cells with reasons. Then runs the seeder, reads the result and reports each decision for review in a PR. Use when the user wants more keys translated from other clients, or names keys to map. Not for adding a new English string (use /translation-add) or for Weblate suggestions.
model: opus
effort: high
---

# /translation-import: map keys to other clients' translations

## Contract

**Goal.** Translate untranslated keys by mapping them to strings other Jellyfin clients' communities already translated, one reviewed batch at a time, highest payoff first. A key in [`locale/seed/keymap.yml`](../../../locale/seed/keymap.yml) is filled in every language its sources translate, every release, so the mapping is the one judgment in that pipeline and it is made per key: the same English in another project can mean something else (web's `PriorityIdle` is a process priority) or be translated with another meaning (web's `MediaInfoChannels` reads "Chaînes", TV channels, in French). The rules are in [`docs/dev/translations.md`](../../../docs/dev/translations.md#map-a-key) and [`locale/CLAUDE.md`](../../../locale/CLAUDE.md); this skill applies them to a batch and leaves an evidence trail a reviewer can check.

**Inputs.** `--limit N`: how many keys, highest payoff first. Default 60. `--key K …`: map these keys instead of the ranked batch. It expects a branch other than `main` with a clean tree, and the seed sources fetchable (the first run of `context` for a source downloads a full checkout of it).

**Outputs.** Entries, `reject:` lines and `exclude:` cells in `locale/seed/keymap.yml`, each with its reason; the seeded locale files and ledger from `translations:seed -- --write`; one local commit, never pushed; and a report: cells filled, a table of every key's outcome with the evidence that decided it, the keys left for a person, and which languages were checked by reading.

**Success criteria.**

- Every mapping rests on named evidence (a key name, a value in a language read, or a code line), never on English text alone.
- A candidate is rejected only for a difference that can be stated; an unclear one is left unmapped and reported, never guessed either way.
- The dry run lists none of the batch under "Needs re-review", and each flagged casing cell is decided by the how-to's rule.
- The report says plainly which languages were read and that the rest came unread from their sources' translators.

**Failure modes to avoid.**

- **Mapping on English text alone.** The would-fill rank says what a mapping is worth, never that it is right; the top-ranked key of the first batch matched on "Added {0}" with web's `AddedOnValue`, a date stamp ("Ajouté le {0}"), not a file name.
- **Rejecting what could not be proven wrong.** A `reject:` is permanent for `suggest`; an unclear candidate belongs on the leave list.
- **Fetching code for every key.** `context` is for candidates the name and values leave unclear; most keys settle without it.
- **Retyping English strings.** An entry seeds only while both English strings match exactly; copy them from the rank output.
- **Pushing or opening the PR.** The batch is reviewed as a PR the user opens with `/pr`.

**When not to use.**

- **Adding a new English string:** use [`/translation-add`](../translation-add/SKILL.md); come back here if another client has the string.
- **Keys with no candidate** (the rank's second header line): `suggest` matches English text only, so finding a source key by meaning is a manual search, outside this skill.
- **Weblate suggestions:** they are a translator's work, reviewed in Weblate, never seeded over.

## Implementation

### Step 1: Check the branch

Work on a branch, never `main` (`git rev-parse --abbrev-ref HEAD`). The batch is reviewed as a PR, so start one from local `main` if needed (`{{type}}/{{slug}}` per `AGENTS.md`, for example `chore/translation-import-batch-2`). The working tree must be clean apart from this skill's own writes.

### Step 2: Rank the batch

```bash
npm run translations:seed -- suggest --rank --limit {{N}} --show fr,de,es,it,pt,nl > "{{scratchpad}}/batch.yml"
```

With `--key`, pass each key and drop `--rank --limit`. The header gives the total cells at stake. Each key lists its candidates by source, each with its own French, German, Spanish, Italian, Portuguese and Dutch values. The would-fill count says what a mapping is worth, never that its candidate is right.

### Step 3: Judge each key

For each key, work out both sides before deciding.

1. **What the JellyRock string is.** Find where it shows: `grep -rn "translationKeys\.{{Key}}\b" source components` and `grep -n '"{{Key}}"' settings/settings.json`. Note its role (a button, a heading, a status phrase, a setting description) and its shape (a bare word, a phrase with `{0}`, a sentence). If the code joins it to another string (`translate(…) + " " + …`), the code fixes the word order, which is wrong in languages that order words differently: the mapping can still be right, so judge it as usual and name the join in the report, since a placeholder string such as "Skip {0}" is the fix.
2. **What each candidate is.** Read the source key's name and its values in the shown languages. A name that names another thing (`Priority…`, `MediaInfo…` against a non-media string, `…Value` for a formatted value), or values that read with another meaning, rule it out.
3. **Unclear after both?** Read the source's code for those candidates, one call per source: `npm run translations:seed -- context --source {{id}} --key {{K1}} --key {{K2}} …`. It shows where the source uses each key at its pinned commit. "No use outside the string files" means a key built at runtime or unused: treat that as unclear, not as a match.

Then give each candidate exactly one outcome:

- **map**: same meaning and same shape. Punctuation is shape: a trailing period, a colon or an ellipsis on one side only rules a candidate out. Map every source whose candidate qualifies; `sources.yml` order decides which fills first, and the others cover locales it lacks.
- **reject**: a different meaning or shape you can name. Record it under the key's `reject:` with that reason, so `suggest` never offers it again.
- **leave**: still unclear after the code. Write nothing for it, and list it in the report as needing a person. Never reject a candidate you could not prove wrong.

**A count key is one set.** Its `Zero`, `One` and `Many` forms fill a locale only together (the seeder refuses a partial set as `plural-set-incomplete`), because `translatePlural()` falls back to English per form. Judge all three; a set whose `Zero` has no exact-text candidate fills nothing, so search the sources for one by meaning ("No songs") and list the set in the report if none fits.

Casing does not decide a match. The seeder never re-cases a value and flags lowercase-first cells for Step 5.

### Step 4: Write the entries

Edit `locale/seed/keymap.yml` in the shape its header describes. Copy both English strings exactly from `batch.yml`: an entry seeds only while both still match. Put each entry in the section for the screen or area where JellyRock shows the key. If none fits, start a section with the file's `# ── {{area}} ──` comment style and one line on what the keys are for. A key with only rejections still gets an entry (its `en` and its `reject:` list) so the rejections are kept.

### Step 5: Run the seeder and read the result

```bash
npm run translations:seed > "{{scratchpad}}/dry.txt"
```

- **Needs re-review** must list none of this batch's keys: one there means an English string was copied wrong.
- **Casing to review:** for each flagged cell, apply the rule in the how-to (exclude it only when the base language gives a better-cased value; a lowercase word in the user's language still beats English). Lowercase count strings ("{0} álbumes") are expected, since most languages lowercase a counted noun: keep them without re-deriving the rule.
- **`plural-set-incomplete`** refusals are expected for a count set with no `Zero` in that locale; they are not a mapping error.
- **Not written:** a placeholder or markup refusal on many locales of one key means its shape differs after all; reconsider the mapping.
- **Values:** recheck each mapped key's values in the languages you read (from `batch.yml`). Drop a wrong cell with `exclude: { {{locale}}: {{reason}} }` under that source.

Then write it, keeping the commit body the seeder prints:

```bash
npm run translations:seed -- --write --summary-file "{{scratchpad}}/seed-body.txt"
npm run lint:translations
```

The seed ledger (`locale/seed/seeded.json`) records every fill, so a cell a reviewer later deletes is never refilled.

### Step 6: Commit and report

Commit `locale/seed/keymap.yml`, `locale/seed/seeded.json` and the locale files in one commit: subject `chore(translations): Map {{n}} keys for seeding (batch {{k}})`, then the counts, then the contents of `seed-body.txt` (its `Translation-Source:` lines). Never push; the user opens the PR with `/pr`.

Report, for the user to review:

- The cells filled, and the total before and after (from the dry run's header).
- A table of every key in the batch: outcome, source keys mapped or rejected, and the evidence that decided it (key name, a value, or a code line).
- The **leave** list, each with what made it unclear.
- The languages checked by reading (`fr`, `de`, `es`, `it`, `pt`, `nl`), and that every other language was taken from its source's translators unread.
