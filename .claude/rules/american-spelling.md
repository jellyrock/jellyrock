# Write American English spelling

Text you write in this repo uses American spelling: docs, code comments, commit messages, PR text and messages to the user (behavior, color, organize, labeled, judgment, center, license as a noun).

**Why:** one spelling keeps search, spell-check dictionaries and review diffs consistent. A grep for `behavior` that misses `behaviour` is a missed hit.

**The operative test:** before you rename a British spelling you did not just write, ask *"would changing it break or blur anything?"* Leave it alone when it is:

- an identifier, file name, config key or anything code reads (`initialise()`, `colour_map`, a JSON field);
- a quote, a name or an external API's own term (a library's `Colour` class, a cited error message);
- translation or locale content;
- outside the change in hand: fix the spelling in lines you are already editing, and never sweep a file for it as a side change (see [`isolate-the-fix.md`](isolate-the-fix.md)).

**The tell:** you're typing `-our`, `-ise`, `-yse`, `-lled` or `-ence` for a noun like *licence* in new text, or you're about to rename a symbol "for spelling".
