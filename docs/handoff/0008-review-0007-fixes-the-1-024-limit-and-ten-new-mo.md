---
id: 0008
title: Review 0007 fixes, the 1,024 limit and ten new modules
from: claude
to: codex
status: open
created: 2026-11-27
refs: docs/ROADMAP.md
---
## Request

### What I want
Three things. (1) Verify my fixes for your eight 0007 findings (see Disposition in 0007) and attack what they added: `admit` passed to every Grab and form-map read, `NL` charging layout to the character budget, the 1.5 MB cap in `checkBoard` and the 6 MB library budget, library metadata handling, the "left out" evidence label, Take version `grid`. (2) Review the guard's new limit of 1,024 events per cycle (owner approved, D19): the new refusal text, and the "Ask the AI to lighten this" offer (`lightenButton`, `lightenWithAI`, the status toast) for anything that could leak data, run without consent or change the board without the person accepting. (3) Review the ten new Strudel modules and options (D20): Palindrome, Segment, Linger, Hurry, Chunk, Inside/Outside, Press; Euclid Rotate and "hits last"; Sample begin/end; Chord Sequencer voicing mode, anchor, offset, octaves and voicing list. Find any case where an imported line plays differently after becoming modules, where a timing call is moved past something that changes the result, where a setting can write code the guard should refuse, or where the module's description is wrong. This feeds the decision to deploy.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed | `npm test` and `npm run build` pass; each 0007 finding has a test named "0007 F1..F8"; the guard has a test for the 1,024 limit | scripts/verify.mjs |
| observed | in the dev server with a placeholder AI key: a Strudel Code module with `.fast(2001)` shows the plain refusal, the "Ask the AI to lighten this" button appears only when a key is set, and clicking it builds a request that carries the refusal and the dense code; the network call was stubbed, nothing was sent | browser |
| observed | the seven new transform modules render in the dev server palette and on the board with no issues | browser, one screenshot |
| observed | for each new module the code it writes plays the same 8 cycles as the same call written by hand, and reads back into the same module and settings (tests in the "ten more transform modules" block) | scripts/verify.mjs |
| observed | `rolled` does not exist in the Strudel core the app runs (1.2.6), and `linger(-0.5)` throws there; so Rolled was not built and Linger holds 1/16 to 1 | probe in the dev setup |
| observed | an import bug found on the way was fixed: `chord("<C Am>/2")` lost its slowdown (every chord lasted one cycle) | scripts/verify.mjs, "Chords:" tests |
| inferred | the importer takes a timing call into a module only when the line has no continuous signal (sine, rand, ...): this is a regex on the statement text (`SIGNALS` in `src/importer.js`), so a signal reached through a variable would not be seen | src/importer.js |
| inferred | Hurry is left as written next to `speed()`; Sample begin/end are left as written next to chop, striate, loopAt, slice, splice, hurry, segment, linger, chunk; I did not test every pair | src/importer.js |
| inferred | the guard allowlist gained one method name, `octaves`; chord `voice` and `anchor` text is checked against a note-name pattern before it is written | src/guard.js, src/compile.js |
| inferred | the density estimate still does not multiply reciprocal rates, sum separate `$:` lines or compose callbacks, so 1,024 is not a total bound (your finding 5) | src/guard.js |
| guessed | the AI's lightened rewrite will be under 1,024; I did not call a real model | - |
| not checked | the new modules in the audio engine (listening); a newer Strudel than 1.2.6; phone; screen reader; the AI offer against a real key; the dialogs after the 0007 fixes in a browser (Grab, Bake, form map, library) | - |

### Read first
- docs/handoff/0007-review-0006-fixes-and-the-curated-library.md (your findings and my Disposition), docs/DECISIONS.md D18, D19, D20
- src/guard.js (`MAX_EXPANDED`, `isTooDense`, the two refusal texts), `lightenButton`, `lightenWithAI`, `renderIssues` and the `engine.onStatus` toast in src/main.js, src/engine.js (`evaluate` refusal)
- the new modules in src/modules.js (`segment` to `press`, `palindrome`, `euclid`, `sample` begin/end, `chords` voicing params), `CALLS` and the chords case in src/compile.js, the `TIMING` set, `timeSafe`, and the euclid/chunk/inside/segment/linger/hurry/press/palindrome and chord voicing branches in src/importer.js
- scripts/verify.mjs: the blocks "ten more transform modules" and "0007"

### Out of scope
- Do not push, deploy or change src/ unless a fix is tiny and you say so. Do not propose Script mode. Do not design G2/G3 or a remote catalogue. Do not review Rolled (not built).

### A good answer looks like
- A numbered list ranked by severity, each finding labelled observed, inferred or guessed with the command or input that shows it. Start with whether each of your eight 0007 findings is closed.
- Direct answers: (1) can a Grab or map read still start after playback began, or a closed window? (2) can the lighten offer run without the person pressing it, send anything beyond the board code and the refusal, or change the board before the person accepts? (3) for each new module, give one input where the imported modules play differently from the original line, or say you tried and found none (name the inputs). (4) does 1,024 refuse any board in the repo (lessons, tools/*.strudel, library, tools/test-board)? (5) are any module descriptions wrong about what the call does in Strudel 1.2.6?
- A final "what I did not check" list. Reply with the branch and commit hash and a short bullet summary, as before.

## Response
<!-- receiver: write below this line, then set status: answered -->

## Disposition
<!-- sender: after reading the Response, one line per numbered finding: accepted | rejected | deferred, with the reason and where it went (ROADMAP section, DECISIONS entry, or a task) -->
