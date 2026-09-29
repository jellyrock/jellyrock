// Tests for the pure parts of the dead-code accuracy tool.
//
// Script under test: scripts/dead-code-accuracy.js
//
// The commands themselves need the real app and git history, and are run by hand
// (`npm run dead-code:replay | dead-code:mutate`). What is pinned here is the
// bookkeeping their numbers rest on: which lines a commit deleted, which bucket a
// deleted declaration lands in, and that an erase really erases.

import { describe, it, expect } from 'vitest';
import {
  parseDeletedLines,
  referenceDeleted,
  classifyDeletion,
  sampleEvenly,
  eraseAt,
} from '../../../scripts/dead-code-accuracy.js';

const DIFF = `diff --git a/source/a.bs b/source/a.bs
index 1..2 100644
--- a/source/a.bs
+++ b/source/a.bs
@@ -3,2 +3,0 @@ sub keep()
-sub gone()
-end sub
@@ -10 +8 @@ end sub
-  old()
+  new()
@@ -20,0 +18,3 @@ end sub
+sub added()
+end sub
+
diff --git a/components/Old.xml b/components/Old.xml
deleted file mode 100644
--- a/components/Old.xml
+++ /dev/null
@@ -1,3 +0,0 @@
-<component name="Old" extends="Group">
-</component>
-
diff --git a/components/Before.bs b/components/After.bs
similarity index 90%
rename from components/Before.bs
rename to components/After.bs
--- a/components/Before.bs
+++ b/components/After.bs
@@ -5 +5 @@
-  x = 1
+  x = 2
`;

describe('parseDeletedLines', () => {
  const { deleted, renames } = parseDeletedLines(DIFF);

  it('records the old-side lines of each hunk, 0-based', () => {
    expect([...deleted.get('source/a.bs').lines].sort((a, b) => a - b)).toEqual([2, 3, 9]);
    expect(deleted.get('source/a.bs').all).toBe(false);
  });

  it('marks a deleted file as losing every line', () => {
    expect(deleted.get('components/Old.xml').all).toBe(true);
  });

  it('records renames old → new, keyed by the old path', () => {
    expect(renames.get('components/Before.bs')).toBe('components/After.bs');
    expect([...deleted.get('components/Before.bs').lines]).toEqual([4]);
  });

  it('does not count a pure addition as a deletion', () => {
    const { deleted: onlyAdded } = parseDeletedLines(
      'diff --git a/x.bs b/x.bs\n--- a/x.bs\n+++ b/x.bs\n@@ -4,0 +5,2 @@\n+a\n+b\n',
    );
    expect(onlyAdded.size).toBe(0);
  });
});

describe('classifyDeletion', () => {
  const { deleted } = parseDeletedLines(DIFF);
  const live = (liveBy) => ({ state: 'live', liveBy });

  it.each([
    ['dead', 'flagged'],
    ['kept', 'kept'],
    ['exempt', 'exempt'],
  ])('puts a %s declaration in %s', (state, bucket) => {
    expect(classifyDeletion({ state, liveBy: [] }, deleted).bucket).toBe(bucket);
  });

  it('calls it a refactor when the same commit deleted a caller, even if a same-name match survived', () => {
    const d = live([
      { rel: 'source/a.bs', line: 9, via: 'bare' },
      { rel: 'source/a.bs', line: 12, via: 'member' },
    ]);
    expect(classifyDeletion(d, deleted)).toEqual({ bucket: 'refactor' });
  });

  it('calls it a miss, naming the references, when the commit deleted none of them', () => {
    const refs = [
      { rel: 'source/a.bs', line: 12, via: 'member' },
      { rel: 'source/b.bs', line: 0, via: 'str' },
    ];
    expect(classifyDeletion(live(refs), deleted)).toEqual({ bucket: 'miss', surviving: refs });
  });

  it('calls it a refactor when the same commit deleted the live component it belongs to', () => {
    const d = live([{ rel: 'components/JRScreen.bs', line: 15, via: 'bare' }]);
    expect(classifyDeletion(d, deleted, { parentDeleted: true })).toEqual({ bucket: 'refactor' });
  });

  it('calls it an override when a function it overrode survives the commit', () => {
    const d = live([{ rel: 'components/JRScreen.bs', line: 26, via: 'bare' }]);
    expect(classifyDeletion(d, deleted, { overrideKept: true })).toEqual({ bucket: 'override' });
  });

  it('checks a reference against its own file only', () => {
    expect(referenceDeleted({ rel: 'source/b.bs', line: 2 }, deleted)).toBe(false);
  });
});

describe('sampleEvenly', () => {
  it('spreads picks across the list, the same way every time', () => {
    const list = Array.from({ length: 10 }, (_, i) => i);
    expect(sampleEvenly(list, 4)).toEqual([0, 2, 5, 7]);
    expect(sampleEvenly(list, 4)).toEqual(sampleEvenly(list, 4));
  });

  it('takes everything when the list is short', () => {
    expect(sampleEvenly([1, 2], 8)).toEqual([1, 2]);
  });
});

describe('eraseAt', () => {
  it('erases the occurrence at or after the column, case-insensitively', () => {
    expect(eraseAt('  foo(foo)', 6, 'FOO', 'X')).toBe('  foo(X)');
  });

  it('leaves the line alone when the text is not there, so the caller can tell', () => {
    expect(eraseAt('  bar()', 0, 'foo', 'X')).toBe('  bar()');
  });
});
