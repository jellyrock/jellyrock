/**
 * Registry of demo TAKES — the single source of truth for `npm run demo` (the runner
 * iterates this for `--list` and lookup). Add a feature demo by dropping a file in this
 * folder and adding one line here; no new npm script (run.mjs is the only entry point).
 */
import castPlay from './cast-play.js';

export const TAKES = [castPlay];
