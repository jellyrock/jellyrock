# Rules for `source/syncplay/`

The pure SyncPlay layer. Read [docs/architecture/syncplay.md](../../docs/architecture/syncplay.md) before changing it.

- **No node and no HTTP here.** `syncPlayHooks.bs` is the one file that reads `m.global`. Everything else takes values in and returns values, so the unit specs and the simulator can run it.
- **Server time is a LongInteger of milliseconds, never a Double.** An AA demotes a Double to a 32-bit float and the time loses its low digits. Convert with `syncPlayTime.asLong()`.
- **One action per look.** New behavior is a rule in `syncPlayConverge.decide()` and a state change in `applied()`. Every node write stays in `SyncPlayManager.carryOut()` and every request in `sendRequest()`.
- **A new rule ships with a unit case that failed first,** and a simulator run. A change to a number in `defaultPolicy()` is measured on a device before and after.
- **A group resume goes through `groupResume()`,** or the OSD stays up after a pause the viewer saw.
- **Pass a float to the logger as `value.toStr()`.** The logger prints a float argument as nothing.
