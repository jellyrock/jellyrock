/**
 * Take: "cast to play" (#550). Fire a runtime cast from another device and it plays on the
 * TV — the canonical Cast-to-JellyRock story. Pure choreography: the privacy-safe lifecycle
 * (snapshot, gates, restore) is the runner's job (run.mjs); a take only declares its setup,
 * its demo server, and its beats.
 */
export default {
  name: 'cast-play',
  description:
    'Cast an item to play from another device — spinner → "Playing <title>" toast → playback.',
  server: 'stable', // resolved + privacy-checked against the public demo servers by the runner

  async run(ctx) {
    const hero = await ctx.getHero();
    // eslint-disable-next-line no-restricted-syntax -- fail-fast on a REST result, before the device is driven
    if (!hero.id) throw new Error('cast-play: could not resolve the hero movie on the demo server');

    await ctx.land('home'); // the opening screen the operator sees when they hit record
    await ctx.startGate(); // "start your capture card, then press ENTER"

    await ctx.hold(3000, 'Home'); // open on a calm, settled Home
    await ctx.cast(`id=${hero.id}|action=play`); // the money moment: spinner → toast → playback
    await ctx.waitPlaying();
    await ctx.hold(9000, 'playback'); // let the toast land + a few seconds of video roll on camera
  },
};
