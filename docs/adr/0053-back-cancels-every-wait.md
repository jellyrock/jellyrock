# ADR 0053: Back cancels every wait; only a local commit ignores it

**Status:** Accepted. Partially supersedes [ADR 0044](0044-spinner-by-kind-of-wait.md) (the Back rule for session changes and for the plain spinner).
**Date:** 2026-10-22

**related-files**: `components/AppWaitHost.bs`, `components/JRScene.bs`, `source/utils/misc.bs`, `source/utils/appWaits.bs`, `source/utils/screenWaits.bs`, `source/loginRouter.bs`, `docs/architecture/navigation.md`

Back is never dead while the app waits. During any network wait it cancels the wait and returns the viewer to where they pressed, sign-in and server connect included. Only a local commit ignores it: saving a token after a sign-in the server accepted, or tearing a session down on sign-out. Those end faster than a press. At boot there is no screen to return to, so Back during the fallback font download shows the exit confirmation. Roku certification asks for this: Back must "directly return the user to the previous screen" (4.6), and an app must "respond to user requests within 10 seconds" (3.4).

So every blocking `startLoadingSpinner()` moves to one of two mechanisms. A screen loading its own data uses a screen wait (`screenWaits`): the screen stays live, and Back leaves through the router. An action the viewer pressed uses an app wait with a cancel, the shape playback starts already use (`appWaits`, `AppWaitHost`). Keys are held while it runs, Back cancels it and shows the screen it was pressed on, and a result that arrives after the cancel is dropped. Sign-in and server connect call the server synchronously on the main thread, so the cancel runs on the render thread and `loginRouter` drops the late answer after each blocking call. A canceled sign-in may still have opened a session on the server; it goes unused.

Measured 2026-10-22 on a Streaming Stick 4K (Roku OS 15.3.4), with one request slowed by 9 s and Back pressed partway through. With a focus hold on every blocking spinner (PR #1238 before this decision), Back did nothing for the whole wait during a details Refresh and an audio seek, where the code before it left at once. The hold also never took effect when details opened: the router focuses a newly opened screen after its open step has started the spinner. The TV guide also focuses itself after `startLoading`.

**Ruled out:** keeping session changes blocking (Back dead for up to the 15 s server lookup in `inferServerUrl`); a focus hold on every blocking spinner (any later focus move ends it silently, and where it holds, it eats Back).
