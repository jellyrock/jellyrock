// Is a PNG already on disk the same IMAGE as one just rendered?
//
// Shared by the two asset generators (scripts/generate/icons-build.js and
// scripts/generate/gradient-assets.js) because they had the same bug: both
// compared raw BYTES to decide whether a committed asset was stale.
//
// Two PNGs can hold identical pixels and differ byte-for-byte. The compressed
// IDAT stream depends on the zlib doing the compressing, and sharp ships its own
// libvips + zlib inside a platform-specific prebuilt binary — so the encoder's
// output changes when sharp changes, even at an exact-pinned version, and
// differs between the machine that generated an asset and the one checking it.
//
// That is not hypothetical. The committed icon PNGs were generated on 2026-05-11
// with sharp 0.34.5; a Renovate bump to 0.35.1 on 2026-06-12 brought a new
// bundled libvips, and from that day `icons:check` reported 55 files as drifted
// while every one of them decoded to byte-identical pixels (max channel delta
// 0 across all 55). It went unnoticed for three months, because the only thing
// running the check was the pre-push hook, gated on the push range touching an
// icon source — which a dependency bump never is.
//
// Pixels are the property worth gating: does the committed asset show the right
// image at the right size. This still catches a stale asset, a missing one and a
// size change; it stops failing on the COMPRESSOR. Note the bound: it is not
// blind to the RENDERER. A libvips change that alters resampling still moves
// pixels and still fails the check — correctly, and loudly.
import sharp from 'sharp';

// Decode to non-premultiplied RGBA. ensureAlpha() normalizes both sides to 4
// channels so an opaque-vs-alpha encoding difference isn't read as drift.
const decode = (buffer) => sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/**
 * @param {Buffer} existingBuffer the PNG currently on disk
 * @param {Buffer} freshBuffer    the PNG just rendered
 * @returns {Promise<boolean>} true when both decode to the same pixels at the
 *   same dimensions. An unreadable or non-PNG existing file returns false, so it
 *   is reported as drift and regenerated rather than throwing.
 * @throws if the FRESHLY RENDERED buffer fails to decode — that is a bug in the
 *   generator, not drift in a committed asset, and must not be reported as one.
 */
export async function matchesRenderedOutput(existingBuffer, freshBuffer) {
  // Fast path: byte-identical needs no decode, which is the common case on the
  // machine that last generated the assets.
  if (existingBuffer.equals(freshBuffer)) return true;

  // Decoded OUTSIDE the try: a failure here is ours. Swallowing it would report
  // a generator bug to the user as "content drift" in a file they did not touch,
  // and `icons:build` would then rewrite every asset from a broken render.
  const fresh = await decode(freshBuffer);

  let existing;
  try {
    existing = await decode(existingBuffer);
  } catch {
    return false; // unreadable / not a PNG → drift, so the caller regenerates it
  }

  // No channels comparison: ensureAlpha() forces 4 on both sides, so dimensions
  // and pixel data are the whole of the difference.
  if (existing.info.width !== fresh.info.width || existing.info.height !== fresh.info.height) {
    return false;
  }
  return existing.data.equals(fresh.data);
}
