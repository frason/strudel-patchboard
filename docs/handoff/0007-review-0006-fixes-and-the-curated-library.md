---
id: 0007
title: Review 0006 fixes and the curated library
from: claude
to: codex
status: open
created: 2026-11-26
refs: docs/ROADMAP.md
---
## Request

### What I want
Two things. (1) Verify my fixes for your eight 0006 findings and attack what they added: `admit` (a check inside the evaluation turn), the Slider defaults a cached pattern restores, the muted-branch pruning in `expansionCost`, the 600,000-character writing budget in `compile()` (result `refused: true`), the Take version `len`, the new storage count, the outline order, the "event record" failure wording and non-string bank reporting. (2) Review the whole-board benchmark (`npm run bench:board`, docs/PERF.md) and the finding it produced: the guard admits a 32-module chain that takes 1.2 s to read once. (3) Review the NEW curated library (D17): boards bundled as files in `library/`, checked by `checkBoard` (extracted from `readShareFragment`) in `src/library.js`, shown in Learn > "Library of boards..." with a "Run the checks" button and "Open a copy". It feeds the decision whether the library can grow beyond four seed boards and whether a remote catalogue is ever worth designing.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed | `npm test` passes; each 0006 finding has a test named "0006 F1..F8"; the library has four tests | scripts/verify.mjs, last blocks |
| observed | Library dialog opened in the dev server; "Run the checks" on "A whole song" gave guard ok and "plays the same 199 attacks over 8 cycles"; "Open a copy" replaced the board (7 modules for Chords) | browser, not a screenshot |
| observed | the seed board "trance" has a read with 2 folded events, so its read-back cannot pass; the label says the 146 attacks match but it is not a full comparison | src/evidence.js |
| inferred | the 0006 F1 test only checks the schema; `setTake` / `restoreTake` in main.js are tested only through your history probe, which I re-ran (len 8 after restore) | src/main.js |
| inferred | `compile()` keeps its character count in a module-level counter; a re-entrant or concurrent compile would corrupt it (compile is synchronous and I found no re-entry) | src/compile.js (top) |
| inferred | the budget counts characters at `S()`; text built outside `S()` (the Take pattern string is one `S`) is counted when it is passed in, but a single huge `S` is counted only after it is built | src/compile.js |
| inferred | `import.meta.glob` bundles `library/*.json` into the app, so a library file is trusted only as far as `checkBoard` checks it; library entries are repo files, not user input | src/main.js, src/library.js |
| observed | `npm run bench:board` (Node): library boards read in under 6 ms; a 2,000-note Take reads in about 90 ms; fan-out depth 11 compiles in 73 ms; a chain of ten `fast` modules (32 modules, 384 characters, about 8,000 events per cycle) is admitted by the guard and takes 1.2 s for one 4-cycle read and 3.7 s for a 32-cycle form map | scripts/bench-board.mjs, docs/PERF.md |
| inferred | the guard's 50,000 events per cycle limit is well above what a reading or the player can take comfortably; I did not change it because the guard is a security boundary and lowering it refuses boards that load today (the owner's call) | src/guard.js, docs/ROADMAP.md |
| guessed | the benchmark's heavy boards (10 chained `fast`, 2,000-note Take) are representative of what real users build; they are constructed, not collected | scripts/bench-board.mjs |
| guessed | the Slider defaults I restore are keyed by Slider id; two different cached patterns that use the same id with different values could still disagree when both are read alternately in one interleave (I tested A, B, A only) | src/snapshot.js |
| not checked | any browser run of Grab, Bake, form map or Earlier takes after the 0006 fixes; audio; phone; screen reader; the library with a hostile file (tests cover wrong kind, bad id, unknown module, null) | - |

### Read first
- docs/handoff/0006-verify-the-0005-fixes-and-the-new-behaviour-they.md (your findings and my Disposition), docs/DECISIONS.md D16 and D17
- scripts/bench-board.mjs and the new section of docs/PERF.md
- src/snapshot.js (`admit`, `defs`), src/compile.js (`compile`, `OVER`, `S`), src/graph.js (`expansionCost`), src/share.js (`checkBoard`), src/library.js, `openLibrary` in src/main.js, library/*.json, scripts/library-seed.mjs, src/evidence.js (`firstDiff`, the `equal` flag)

### Out of scope
- Do not push, deploy or change src/ unless a fix is tiny and you say so. Do not propose Script mode. G2 and G3 are not built; do not design them. Do not design a remote catalogue; say only whether the file format would survive one.

### A good answer looks like
- A numbered list ranked by severity, each finding labelled observed, inferred or guessed with the command or input that shows it. Start with whether each of your eight 0006 findings is closed.
- Direct answers: (1) can the 600,000-character budget or the muted pruning be wrong (a board refused that should open, or one that still builds a large string or takes long before the budget trips)? (2) does the `admit` check close the stopped-to-playing race for Grab, and what about the form map reads and the x-ray? (3) can a library file or a board opened from it do anything a share link could not (guard, sample packs, names, sizes)? (4) are the library's evidence labels fair, including the "match but not a full comparison" wording? (5) do D16, D17 or my Disposition overclaim? (6) is the benchmark honest and complete enough to support a recommendation on the guard's per-cycle event limit (what limit would you choose, what real boards would it refuse, and what else should be measured in a browser)? Add any heavy shape I missed that the guard admits.
- A final "what I did not check" list. Reply with the branch and commit hash and a short bullet summary, as before.

## Response
<!-- receiver: write below this line, then set status: answered -->

## Disposition
<!-- sender: after reading the Response, one line per numbered finding: accepted | rejected | deferred, with the reason and where it went (ROADMAP section, DECISIONS entry, or a task) -->
