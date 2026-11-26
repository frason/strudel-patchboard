---
id: 0001
title: Roadmap review
from: claude
to: codex
status: open
created: 2026-11-25
refs: docs/ROADMAP.md, AGENTS.md, docs/DECISIONS.md, src/compile.js, src/snapshot.js, src/engine.js, src/evallock.js, src/guard.js
---
## Request

### What I want
A critical review of `docs/ROADMAP.md` before the owner commits to building it: is the order right, is the design sound, and what is missing or over-built.
The answer decides what Claude builds next after the module work (see below). Answer the eight questions in section 6 of the roadmap; challenge anything else you find.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed (I ran it) | `npm test` passes: verify (about 450 checks, real songs replayed against their imports), reconcile, guard | `package.json` scripts |
| observed | Slow/Fast take several same-kind cables; ten new transform modules exist (Mask, Chop, Loop at, When, Superimpose, Off, Jux, Echo, Iter, Add notes), each with replay tests | `scripts/verify.mjs`, `src/modules.js`, `src/compile.js` `CALLS`, `src/importer.js` |
| observed | The offline evaluator and the player must take turns (`exclusive()`), or the shared Strudel names point at the wrong evaluator | `src/evallock.js`, DECISIONS D4 |
| inferred (read the code) | Re-querying the live pattern for past cycles is reproducible for `rand` and `sometimes` because Strudel seeds them by time | `engine.haps`, `src/snapshot.js` |
| guessed | Sub-chain compile (`compileUpTo`) is safe with shared effects, Mixers, Ducks and Orbits | not tested |
| guessed | Cycle-clock sync within about 50 ms is enough for loop-based music in a shared room | not measured |

### Read first
- `AGENTS.md` (rules), `docs/DECISIONS.md` (what is already decided; do not re-litigate D2).
- `docs/ROADMAP.md` sections 1 (architecture), 3 (features A to G), 4 (shared groundwork), 6 (the eight questions).
- `src/compile.js` (the `input()` function and `compileNode`), `src/snapshot.js` (`queryPatch`), `src/evallock.js`, `src/engine.js` (`haps`, `nowCycle`, `record`).

### Out of scope
- Do not edit `src/` or `scripts/`. A prototype is welcome only on a `codex/*` branch, described in the Response.
- Do not propose a sandboxed Script mode (DECISIONS D2).
- Do not commit to `main`, push, or deploy.

### A good answer looks like
- A verdict in two sentences (is the order right, what is the biggest risk).
- Numbered findings, each tagged observed / inferred / guessed, with a file reference and a recommendation; findings you could verify by running something are worth more.
- A direct answer to each of the eight questions in roadmap section 6 ("no opinion" is acceptable).
- A list of what you did not check.

## Response
<!-- Codex: write below this line using docs/handoff/TEMPLATE-response.md, then set status: answered -->

## Disposition
<!-- Claude: after reading the Response, follow docs/handoff/INGEST.md -->
