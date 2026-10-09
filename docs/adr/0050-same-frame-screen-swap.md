# ADR 0050: Screens change in one render pass: every route suspends with "show" and JellyRock drives the swap

**Status:** Accepted. Partially supersedes [ADR 0029](0029-destroy-routed-screens-on-pop.md) (its `suspendMode: "detach"`; its `keepAlive` and destroy-on-pop rules stand)
**Date:** 2026-10-08

**related-files**: `components/JRScene.bs`, `components/JRScreen.bs`, `components/JRScreen.xml`, `components/AppWaitHost.bs`, `docs/architecture/navigation.md`

Going forward, the old screen vanished before the new one appeared, and the old overhang stayed over an empty screen. sgRouter runs the outgoing view's suspend (hide it, then `onViewSuspend`) and the incoming view's `onViewOpen` as separate promise steps, so with `"hide"` or `"detach"` the gap is built into its documented order. Measured 2026-10-07 on a Streaming Stick 4K: 122 to 161 ms forward, 2 to 16 ms back. Every route now suspends with `"show"`, which sgRouter documents for a transition the app drives, so the router leaves a covered view on screen. `JRScene.onActiveRoutedViewChanged()` runs inside the incoming view's `onViewOpen`. It calls `JRScreen.hideCovered()` on the previous view, which hides it and runs its `onScreenHidden()`, in the same synchronous call that projects the new overhang. Measured after: 0 to 2 ms. `onScreenHidden()` moved from suspend to the swap, because at suspend the screen is still visible. A playback start hides its launching screen before any navigation, so `AppWaitHost` hides the overhang with it, by `opacity`, which neither the router nor the overhang controller touches.

Covered screens now stay in the outlet's `viewTarget`, hidden, instead of in the detach store sgRouter keeps. That also lets `teardownRoutedViews` reach them at sign-out, which `"detach"` prevented. Measured 2026-10-07 on a 512 MB Streaming Stick, two runs per arm, three screens covered: texture memory was unchanged, and app memory was 0.5 MiB lower on a cast page and 0.9 MiB higher in the player.

**Ruled out:**

- **Patching sgRouter to hide and show in one step.** It would leave a patch to carry against a vendored, regenerated dependency.
- **Clearing the overhang when a screen is covered.** The overhang lines up with the old screen leaving, but the new screen still arrives late, and quickplay keeps a stray clock.
- **Keeping `"detach"` for details, library and search.** Detach removes the view at suspend, so the gap stays on exactly those routes.
- **Not hiding the screen at playback start.** It would keep a screen that looks usable under the spinner for the seconds a queue can take to build.

**Revisit if:** memory on a 512 MB device becomes a constraint (measure covered-screen cost again), or sgRouter starts guaranteeing that the outgoing hide and the incoming show happen in one step.
