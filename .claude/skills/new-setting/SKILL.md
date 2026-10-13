---
name: new-setting
description: Guided workflow for adding a new user setting or global setting to JellyRock. Walks the recipe in docs/dev/new-user-setting.md (pick the kind, add the settings/settings.json entry, add its strings, add the JellyfinUserSettings field, read it in code, test it). Stops at each step to verify and gives the user the relevant file paths. Use when adding a toggle, a choice, a number or a text setting that the user can change in the JellyRock Settings screen.
model: sonnet
effort: low
---

# /new-setting: a guided workflow

Wraps [`docs/dev/new-user-setting.md`](../../../docs/dev/new-user-setting.md) as a step-by-step. The guide is the source of truth; this skill makes sure no step is skipped. Read the guide's section for each step before doing it.

## Step 0: Confirm a setting is the right answer

There are three kinds of settings-shaped state ([the guide's table](../../../docs/dev/new-user-setting.md#three-kinds-of-setting)):

1. **User setting:** saved in the user's registry section, for one user. Named by area: `playback*`, `ui*`, `itemGrid*`.
2. **Global setting:** saved in the `JellyRock` registry section, for everyone on the device. Named `global*` (**Remember Me?** is `globalRememberMe`). The prefix is what decides where the value is saved: `isGlobalSetting()` in `source/utils/config.bs` checks it.
3. **User configuration:** owned by the Jellyfin server. JellyRock never stores it; read it from `m.global.user`.

Search `settings/settings.json` for a setting that already covers the behavior (a new "Show clock on the player" would overlap `uiDesignHideClock`). If one does, ask whether to extend it instead. If the server already tracks the value per user, stop: don't add a setting, read it from `m.global.user`. Don't add one for state that lasts one session, or for something the app can detect on the device either. If unsure between the first two, pick a user setting; it is the common case.

## Step 1: Add the entry to `settings/settings.json`

This is the one source of truth for defaults. `user.settings.SaveDefaults()` fills every field from it at start-up and at sign-in, and a default is never written to the registry: only a value the user changed is.

Follow [the guide's step 1](../../../docs/dev/new-user-setting.md#1-add-the-entry-to-settingsjson): put the entry in its category's `children`, in order of `title`. `settingName` is `lowerCamelCase` with its area's prefix, and specific (`playbackPlayDefaultAudioTrack`, not `playbackAudio`). Pick the `type` from the guide's table, which also gives the field type it needs. Read [`settings/settings.json`](../../../settings/settings.json) for the shape before editing.

The Settings screen (`components/settings/settings.bs`) builds its menu from this file, so a setting of an existing `type` needs no UI code. `visibleWhen` and `presetValues` cover showing an entry conditionally and setting several values at once.

## Step 2: Add the strings

Add each new `titleKey` and `descriptionKey` (and each option's `titleKey`) to `locale/custom/en_US.json` through [`/translation-add`](../translation-add/SKILL.md). The Step 1 entry is what uses these keys, so `update-translations` won't remove them as unused (the warning in `/translation-add` is about keys only code uses). `npm run lint:translations` checks the keys `settings.json` uses.

## Step 3: Add the field to `JellyfinUserSettings`

Add a field to [`components/data/jellyfin/JellyfinUserSettings.xml`](../../../components/data/jellyfin/JellyfinUserSettings.xml), in its area's section, as [the guide's step 3](../../../docs/dev/new-user-setting.md#3-add-the-field) shows:

- the `id` matches `settingName` exactly, because the value is saved and loaded under it;
- the type comes from the guide's table (a `radio` setting is a `string`);
- give it no `value`: the default comes from `settings.json`.

No `.bs` change is needed. `JellyfinUserSettings.bs` observes every field and saves a change once auto-sync is on, and `user.Login()` (`source/utils/session.bs`) loads every registry key that names a field through `user.settings.Save()`, which converts it to the field's type.

## Step 4: Read it in code

Read `m.global.user` into a local once, then `localUser.settings.<settingName>`. When the setting overrides a server value, write one function that decides between them and call it everywhere; [the guide's step 4](../../../docs/dev/new-user-setting.md#4-use-it) shows `resolvePlayDefaultAudioTrack()`. Search for every place the behavior lives (`git grep -n "<related term>" -- source components`) so the setting changes all of them.

## Step 5: A registry migration, only when changing an existing setting

Renaming or removing a setting, or changing the shape of its stored value, needs a registry migration: use [`/new-migration`](../new-migration/SKILL.md). A new setting needs none: a user who never set it gets the default from `settings.json`.

## Step 6: Test it

A plain on/off setting read in one place may need no unit test, only the on-device checks in Step 7. Otherwise follow [the guide's step 5](../../../docs/dev/new-user-setting.md#5-test-it): unit-test a resolving function in `tests/source/unit/<area>/` (cover each option, the server's value, `invalid` nodes and an unexpected value). A suite that touches the registry uses `test-` section names and sets `m.needsRegistrySetup = true` before `super.setup()`, so its sections are cleared after each test ([`unit-tests.md`](../../../docs/dev/unit-tests.md)).

## Step 7: Verify

```bash
npm run validate
npm run lint:translations
```

Then on hardware: `npm run device:check`, and when a device answers, `npm run test:tdd` with your spec listed, then the guide's on-device checks (the setting shows, survives a restart, changes the behavior, and the default applies to a user who never changed it). If the probe fails, say the probe failed; never claim "tested" without a green run.

`docs/user/app-settings.md` is generated from `settings.json`. The `jellyrock-bot` workflow regenerates it after the change merges, and `npm run docs:settings` does the same locally. Never edit it by hand.

## Common pitfalls

- **No default in `settings.json`.** The field then reads its type's default (an empty string, 0, false), and code that reads it may misbehave.
- **Writing the default to the registry.** Defaults belong only in `settings.json`, so that changing a default reaches every user who never changed the setting.
- **A field `id` that differs from `settingName`.** The value is saved under one name and loaded under the other, so it never comes back.
- **A global setting without the `global` prefix**, or a user setting with it: the value is saved in the wrong section.
- **A registry test without `m.needsRegistrySetup = true`.** Sections leak into the next suite and fail it.

## When not to use

- The value is owned by the server: read it from `m.global.user`.
- You're renaming or removing an existing setting: use `/new-migration`.
- You're adding a developer-only debug flag: see [`docs/dev/debug-flags.md`](../../../docs/dev/debug-flags.md); flags are different machinery.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/new-setting/SKILL.md and follow the steps for adding the setting <setting-name>; surface each step's file paths and the diffs to apply but do not commit` in the Agent prompt.
