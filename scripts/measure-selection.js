/**
 * WHICH sample of a launch is "the" sample — the one rule, in one place.
 *
 * ## Why this is a module rather than a few lines in `measure.js`
 *
 * A launch can produce several samples, because a navigation can mount several screens
 * on the way to the one asked for. Deciding which of them a number describes is the
 * whole correctness question of this subsystem: get it wrong and the tool publishes a
 * well-formed record about the wrong screen, which no reader afterwards can detect.
 *
 * That rule was implemented THREE times — the per-launch progress line and the series
 * summary in `measure.js`, and `coldSamples()` in `measure-compare.js` — and two of the
 * three were wrong. `measure.js` published `videoPlayer` at 2135 ms while
 * `measure:compare` read the same record back as 254 ms, because compare still selected
 * by position. One rule with three implementations is not a rule.
 *
 * It is also the half of the tool that could not be tested. `measure.js` claims the
 * device on import, so nothing in it is reachable from a unit test — which is exactly
 * why `measure-args.js` exists, and the argument applies with more force here: every
 * defect found in this subsystem so far has been in the selection layer, and every one
 * was found by hand on hardware. These are pure functions of `(samples, selector)`.
 *
 * ## The selector, and the two field names for one idea
 *
 * A SAMPLE carries its identity under `dimensions` (`component`, `variant`). A RECORD
 * carries the same idea at top level under `component` and `screenVariant` — renamed
 * because `runProvenance()` already spreads a `variant` of its own (which npm script
 * ran). Rather than teach this module both shapes, callers normalise to
 * `{component, variant}` and map their own field names at the boundary.
 */

/** The two dimensions that identify a mount, joined for display. `''` when unstamped. */
export function mountIdOf(dimensions) {
  return [dimensions?.component, dimensions?.variant].filter(Boolean).join('/');
}

/**
 * Does this sample match the mount that was NAMED?
 *
 * Vacuously true when the selector names nothing, which is what lets every caller share
 * one predicate and fall back to first-mount on its own terms.
 */
export function selectsMount(dimensions, selector = {}) {
  return (
    (!selector.variant || dimensions?.variant === selector.variant) &&
    (!selector.component || dimensions?.component === selector.component)
  );
}

/**
 * What the app actually stamped across a series, and whether it is ambiguous.
 *
 * `multiMount` asks whether any single launch carried more than one distinct identity —
 * and identity is component AND variant, because the two ways a launch can carry several
 * samples are different in shape and each is invisible to the other half:
 *
 *   - Same component, different variant — a CHAINED nav. Reaching a Season loads its
 *     Series first. Told apart by `variant`.
 *   - Different component, same variant — a PLAYBACK nav. Reaching the player means
 *     walking through `ItemDetails`, and for a movie both stamp `Movie`. Told apart
 *     only by `component`.
 *
 * `stillAmbiguous` then asks the SAMPLES, not the flags, whether what was named narrows
 * a launch to one. "Did the operator pass something" is the wrong question: `--variant
 * Movie` is passed and still ambiguous when both mounts of a playback nav stamp `Movie`,
 * which is how keying on variant alone survived being "fixed" once already.
 */
export function analyseMounts(samples = [], selector = {}) {
  const idsPerLaunch = new Map();
  for (const s of samples) {
    const id = mountIdOf(s?.dimensions);
    if (!id) continue;
    if (!idsPerLaunch.has(s.launch)) idsPerLaunch.set(s.launch, new Set());
    idsPerLaunch.get(s.launch).add(id);
  }

  const distinct = (fn) => [...new Set(samples.map(fn).filter(Boolean))];

  return {
    observedVariants: distinct((s) => s?.dimensions?.variant),
    observedComponents: distinct((s) => s?.dimensions?.component),
    observedIds: distinct((s) => mountIdOf(s?.dimensions)),
    multiMount: [...idsPerLaunch.values()].some((set) => set.size > 1),
    // Counted in distinct IDENTITIES that still match, not in matching samples. One
    // identity mounted twice in a launch — queue advancement remounts the player — is not
    // an ambiguity to refuse: the first is the cold one and the second is a later run,
    // which is the same rule that already keeps a warm refresh out of a cold median.
    // Counting samples would have refused that launch and asked the operator for a flag
    // that cannot exist, since no flag can separate a thing from itself.
    stillAmbiguous: [...idsPerLaunch.keys()].some(
      (launch) =>
        new Set(
          samples
            .filter(
              (s) => s.launch === launch && s.complete && selectsMount(s?.dimensions, selector),
            )
            .map((s) => mountIdOf(s?.dimensions)),
        ).size > 1,
    ),
  };
}

/**
 * Why no median may be published — or `null` when one may.
 *
 * A launch that mounted more than one screen has no obvious "the" sample, and picking one
 * by POSITION is how the tool confidently reports the wrong screen: for `--nav
 * episodeDetails`, the first mount is the Series. Rather than guess — by position, or by
 * "the last one", a heuristic that breaks the first time an intermediate screen re-mounts
 * — refuse the median and say what to pass. Same posture the tool takes on an ambiguous
 * library, and the Charter's "never silently averaged" applied to the case that can
 * actually produce it.
 *
 * Order matters: a flag that matched NOTHING is reported before ambiguity, because the
 * ambiguity message would otherwise tell the operator to pass a flag they just passed.
 */
export function selectionRefusalFor(samples = [], selector = {}, analysis = null) {
  const { observedVariants, observedComponents, observedIds, multiMount, stillAmbiguous } =
    analysis || analyseMounts(samples, selector);

  // Checkable, and therefore checked — the difference between these flags and `--screen`,
  // which the record can only ever repeat back as an assertion.
  if (selector.variant && !observedVariants.includes(selector.variant)) {
    return (
      `--variant ${selector.variant} matched no sample. The app stamped: ` +
      `${observedVariants.length ? observedVariants.join(', ') : '(none)'}.`
    );
  }
  if (selector.component && !observedComponents.includes(selector.component)) {
    return (
      `--component ${selector.component} matched no sample. The app stamped: ` +
      `${observedComponents.length ? observedComponents.join(', ') : '(none)'}.`
    );
  }
  if (multiMount && stillAmbiguous) {
    const named = [
      selector.component ? `--component ${selector.component}` : null,
      selector.variant ? `--variant ${selector.variant}` : null,
    ].filter(Boolean);

    // Naming nothing and naming half are different dead ends, and one message for both
    // sends the operator in a circle — telling them to pass a flag they just passed. When
    // something WAS named, the useful thing to say is which mounts it still leaves and
    // therefore which OTHER dimension separates them: naming `--variant Movie` on a
    // playback nav still matches both the details screen and the player, and `--component`
    // is the half that tells them apart.
    if (!named.length) {
      return (
        `this navigation mounted more than one screen per launch (${observedIds.join(', ')}), ` +
        'and nothing was named. Re-run naming a mount with --component <name> and/or ' +
        '--variant <name>.'
      );
    }
    const missing = selector.component ? '--variant' : '--component';
    return (
      `${named.join(' ')} still matches more than one mount per launch ` +
      `(saw ${observedIds.join(', ')}), so it does not say which you meant. Add ${missing} ` +
      '— it is the half that separates them.'
    );
  }

  // Every launch mounted ONE screen, and they were not all the same one.
  //
  // Checked AFTER the ambiguity above, so a launch that offered several mounts is
  // reported as that rather than as this — its message already asks for the flag that
  // would resolve both.
  //
  // Distinct from every case above, and it is the one no per-launch check can see: there
  // the operator must name a mount because a single LAUNCH offered several, and here
  // every launch offered exactly one — but WHICH one was decided by the ENVIRONMENT
  // rather than by the run. `setServer` is the first instrument with that property: it
  // stamps `discovered` when SSDP answered on that launch and `savedOnly` when it did
  // not, so a LAN where discovery is intermittent yields a series that is two
  // populations with nothing per-launch to flag. Every variant before it was a property
  // of what the nav opened (the item type, the library type) and therefore constant
  // across a series by construction.
  //
  // REFUSED rather than warned, and the record is why. A warning prints and is gone;
  // with nothing named `measure.js` writes `screenVariant` from the FIRST sample, so a
  // six-and-nine split would publish a median over both populations LABELLED as whichever
  // the first launch happened to draw — a well-formed record that no reader afterwards
  // can detect, which is the failure this module exists to prevent. A refusal nulls both
  // selection fields and leaves `observedVariants` to say what was really seen.
  //
  // Computed over the SELECTED samples, never all of them. A no-server launch
  // legitimately mounts `preLogin/start` AND `setServer/savedOnly`, so the naive form
  // fires on every correct run of the very screen that motivated it — and a refusal that
  // fires routinely is worse than none, for the same reason the ledger declines to warn
  // on an ordinary post-settle refresh.
  if (!selector.variant) {
    const tally = new Map();
    for (const sample of selectColdSamples(samples, selector)) {
      const variant = sample?.dimensions?.variant;
      if (!variant) continue;
      tally.set(variant, (tally.get(variant) ?? 0) + 1);
    }
    if (tally.size > 1) {
      const seen = [...tally.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .map(([variant, n]) => `${variant} ×${n}`)
        .join(', ');
      return (
        `the launches in this series did not all measure the same variant (${seen}), so a ` +
        'median over them would be a median over more than one population. Each launch ' +
        'mounted exactly one screen, so no flag was missing at the time — which variant you ' +
        'got was decided by the environment (for `setServer`, whether SSDP answered that ' +
        'launch). Re-run naming one with --variant <name>.'
      );
    }
  }
  return null;
}

/**
 * The cold sample of each launch — the FIRST complete one matching whatever was named.
 *
 * With nothing named, the first mount, which is what every single-mount screen has always
 * meant and what the two IDENTITY-less legacy families still mean. The later runs in a
 * launch are real (Home's `refresh()` re-runs the load) and are recorded, but they are a
 * different measurement — a warm re-render, not a first paint — and pooling them would
 * undo the refusal to average them.
 */
export function selectColdSamples(samples = [], selector = {}) {
  // A selector only APPLIES if the samples can answer it, and this is about which FAMILY
  // emitted them rather than about old records. `home-latest-rows` (what bare
  // `npm run measure` samples) and `item-grid` stamp no mount IDENTITY, so matching a named
  // mount against them selects zero samples and reads as "this series is empty" — a
  // `--variant` on a record of either family would silently empty it. No identity means
  // position is all there is, which is what those two families have always meant.
  //
  // ⚠️ "Stamps no identity" is NOT "carries no dimensions", and the two were the same thing
  // until they weren't: `home-latest-rows` now emits `sizeAt` (which Home row was dropped
  // mid-load), so the family DOES have a dimension. This still works because `mountIdOf`
  // reads only `component` + `variant`, which is the narrower guarantee this line depends
  // on — do NOT relax it to "has any dimension", or a `--variant` empties the series again.
  // `measure-selection.test.js` pins that.
  const stamped = samples.some((s) => mountIdOf(s?.dimensions));
  const named = stamped && Boolean(selector.component || selector.variant);
  const launches = [...new Set(samples.map((s) => s.launch))];
  return launches
    .map((launch) =>
      samples.find(
        (s) =>
          s.launch === launch &&
          s.complete &&
          (named ? selectsMount(s?.dimensions, selector) : s.indexInLaunch === 0),
      ),
    )
    .filter(Boolean);
}

/**
 * The mounts of one launch that were NOT selected, named rather than counted.
 *
 * They used to be described as "later runs", which was true only while the selected sample
 * was always the first one. A selector can now name a mount that came second — `--variant
 * query` on the search screen selects the query, and the other sample is the screen OPENING,
 * before it — so the per-launch progress line reported a screen-open as a re-render that
 * followed the search. Naming them also makes the line checkable: "+1 other" says something
 * happened, `searchResults/open` says what.
 *
 * `cold` is compared by IDENTITY, so callers must pass the very object `selectColdSamples`
 * returned out of this same array rather than a re-shaped copy of it.
 */
export function otherMountsIn(launchSamples = [], cold = null) {
  return launchSamples
    .filter((s) => s !== cold)
    .map((s) => mountIdOf(s?.dimensions) || `#${s?.indexInLaunch}`);
}

/**
 * How many launches came back empty, split by WHY — because the two causes have opposite
 * next steps and one count cannot carry both.
 *
 * `withoutAnySample` is the app emitting nothing the registry recognised: a build without
 * `perfTiming`, an ungrounded pattern, a screen that never painted. `withoutNamedMount`
 * is the app emitting fine while the mount that was NAMED is missing from that launch —
 * a playback that never reached its first frame, say, on a launch where the details
 * screen it walked through recorded perfectly. Counting only the first hides the second
 * behind a healthy-looking sample count, which is the opposite of this file's
 * "reported, not dropped" posture.
 */
export function launchAudit(samples = [], selector = {}, launchCount = 0) {
  const complete = samples.filter((s) => s.complete);
  const launches = [...Array(Math.max(0, launchCount)).keys()];
  const withoutAnySample = launches.filter((i) => !complete.some((s) => s.launch === i));
  const withoutNamedMount = launches.filter(
    (i) =>
      complete.some((s) => s.launch === i) &&
      !complete.some((s) => s.launch === i && selectsMount(s?.dimensions, selector)),
  );
  return {
    completeSamples: complete,
    withoutAnySample: withoutAnySample.length,
    withoutNamedMount: withoutNamedMount.length,
  };
}
