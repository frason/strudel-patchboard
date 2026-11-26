---
id: 0002
title: Review the event record, raw tap, x-ray, test board and AI docs
from: claude
to: codex
status: open
created: 2026-11-26
refs: docs/ROADMAP.md, docs/PERF.md, docs/DECISIONS.md, docs/TEST-BOARD.md, src/events.js, src/xray.js, src/compile.js, src/snapshot.js, src/aidocs.js, src/featuretest.js, scripts/perf-play.mjs, scripts/build-docs.mjs, scripts/make-test-board.mjs, scripts/verify.mjs
---
## Request

### Where the code is
This review needs the owner's commit that contains `src/events.js`. If that file does not exist in your worktree (merge `main` into your `codex/*` branch first), the owner has not committed yet: stop and say so in the Response instead of reviewing something else.

### What I want
A critical review of what was built from your handoff 0001 recommendations, and of the additions around it: the performance harness, the event record, the raw cable tap, the pinned x-ray, the **Feature test** board (also lesson 34), and the AI-facing documentation (static pages, `llms.txt`, "Copy for an AI chat").
Tell me where the code does not do what its comments, `docs/DECISIONS.md` (D9, D10, D11) and `docs/PERF.md` claim, what would break under real use, and whether the measurements support the conclusions drawn from them.
This decides whether Grab and Bake (the next steps in `docs/ROADMAP.md` section 8) can build on these foundations, and whether the Feature test is a trustworthy way for the owner to try the newer modules.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed (I ran it) | `npm test` passes (verify about 480 checks, reconcile, guard, handoff check). New checks cover the event record, Take conversion reports, the tap fixtures, slider isolation, the test board and the docs | `scripts/verify.mjs` (search "Events", "Tap:", "Slider:", "Test board", "Docs:") |
| observed | For 30 lessons with a neutral master and no Mixer or Duck, the raw taps of all voices together play exactly what the whole board plays (31 with the new lesson) | `scripts/verify.mjs`, the last Tap check |
| observed | With the x-ray reading every 0.5 s (worst case) during playback, headless Chrome showed zero skipped notes, underruns and stalls and no cost over the same build idle, on three boards, three runs each | `docs/PERF.md`; rerun `npm run build && npm run perf:play` (the `.perf/` results are not committed) |
| observed | In the browser, a Slider moved while playing stayed put through offline queries, and the player's `sliderWithID` was unchanged | manual pane check, handoff 0001 Disposition F2 |
| observed | The Feature test board (9 groups, 34 modules) loads with no cable removed, every group produces events over 4 cycles, the guard accepts its code, and the DJ filter warns once its group is unmuted | `scripts/make-test-board.mjs`, `docs/TEST-BOARD.md`, the "Test board" checks |
| observed | The production build writes 83 documentation files (about, import guide, one page per module, `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml`) from the module definitions; the production preview serves them with the security headers and the app still loads with no console errors | `npm run build`, `npm run preview` |
| inferred | A tap's `outside` list covers downstream modules, master, Mixer and orbit/duck, but is not tested for Arrange, Duck leads or shared Orbit effects | `src/compile.js` `compileTap` |
| inferred | The generated docs state facts about the app (no cookies, no analytics, hosts it talks to, limits); each was checked against the code once by hand, not by a test | `src/aidocs.js` `GUIDES()` |
| guessed | 20 s windows and three repeats are enough to see a regression; the 25% plus allowance rule in `docs/PERF.md` is a sensible margin | not validated; chosen from the spread seen |
| not done | The contextual "final voice" view, the guard cap on expanded mini-notation, the Corporeal audio-parity check, any phone measurement, any listening test of groups 3 to 9 of the Feature test | `docs/ROADMAP.md` section 9 |

### Read first
- `docs/ROADMAP.md` sections 8 and 9, `docs/DECISIONS.md` D9 to D11, `docs/PERF.md`, `docs/TEST-BOARD.md`.
- `src/events.js` (the record, the Take conversion), `src/snapshot.js` (`queryHaps`, `queryEvents`, the slider swap), `src/compile.js` (`compileTap`, and the ten transform calls in `CALLS`), `src/xray.js`, `scripts/perf-play.mjs`.
- For the Feature test: `scripts/make-test-board.mjs`, `src/featuretest.js` (generated), and the lesson entry at the end of `src/starters.js`.
- For the AI docs: `src/aidocs.js`, `scripts/build-docs.mjs`, `index.html` (structured data and noscript text), `public/_headers`.

### Out of scope
- Do not edit `src/` or `scripts/` (a prototype only on a `codex/*` branch). Do not propose Script mode (D2). Do not commit to `main`, push or deploy.

### A good answer looks like
- A verdict in two sentences, then numbered findings tagged observed, inferred or guessed, each with a file reference.
- Specifically: (1) cases where `compileTap` or the record is wrong or misleading (try Arrange, Duck, shared Orbit, Mixer solo, muted upstream modules, sliders, Take and Harmonics); (2) whether the performance harness can miss a real regression (what it does not exercise); (3) the x-ray's own risks (accessibility, phone layout, hidden-tab behaviour, query cost on huge patterns); (4) what you would change before Grab builds on the record.
- On the Feature test: whether any of its nine groups could pass its checks yet still behave wrongly for the owner (a muted group, a cable that does the wrong thing, a module that sounds the same with its setting changed), and which module combinations it should add.
- On the AI docs: anything the generated pages or `llms.txt` say that is false, overclaims, or could mislead a crawler or a chatbot; and whether the `robots.txt` and the unofficial notice are right.
- A list of what you did not check.

## Response
<!-- receiver: write below this line, then set status: answered -->

## Disposition
<!-- sender: after reading the Response, one line per numbered finding: accepted | rejected | deferred, with the reason and where it went (ROADMAP section, DECISIONS entry, or a task) -->
