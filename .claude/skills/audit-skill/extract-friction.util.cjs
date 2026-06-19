// Shared pure helpers for extract-friction.cjs and its consumer config.
//
// Repo-agnostic and synced verbatim, like the core. It exists so the core and a
// consumer's rule detectors (in extract-friction.config.cjs) can share these
// utilities WITHOUT duplicating them: the core require()s the config at load,
// so the config can't require() the core back (circular) — but both can safely
// require() this leaf module, which imports nothing.

'use strict';

// Truncate text to `limit` chars with an ellipsis, for compact evidence strings.
function preview(text, limit = 200) {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

// Find the tool_result for a given tool_use id by walking forward from fromIdx.
// tool_results often land in the user turn just past range[1], so we look ahead
// in the full turn list (bounded window).
function findResultByToolUseId(turns, fromIdx, toolUseId, _range) {
  if (!toolUseId) return null;
  const limit = Math.min(fromIdx + 10, turns.length);
  for (let j = fromIdx; j < limit; j++) {
    for (const tr of turns[j].toolResults) {
      if (tr.toolUseId === toolUseId) return tr;
    }
  }
  return null;
}

module.exports = { preview, findResultByToolUseId };
