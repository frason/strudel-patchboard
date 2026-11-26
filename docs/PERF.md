# Playback performance

Performance is the first gate for new features (docs/ROADMAP.md section 7; handoff 0001, finding F1). This is how it is measured, where it stands, and what is not covered.

## Method
`npm run build && npm run perf:play` (`scripts/perf-play.mjs`; shared browser plumbing in `scripts/cdp.mjs`; the judging rule in `scripts/perfjudge.mjs`, which has its own tests). It loads the production build in headless Chrome, presses play on real boards,
waits 7 s for the sounds to download, then measures a 20 s window, **three runs per board by default**, and reports the **worst** of the three:
- **notes skipped**, **audio underruns** and **page stalls over 0.15 s**: the app's own audio-health counters, read fresh from Settings at both ends of the window (the panel is closed and opened again, because it writes its text only when it opens);
- **long tasks** (the browser's own report of main-thread work over 50 ms), CPU time per second, time spent in animation frames, and **heap growth after a garbage collection**.
A run only counts if the music was playing when the window began and when it ended, the audio clock moved through it, and (with a load) the load really started. A counter the browser cannot give is "not measured", never zero.
Boards: the "whole song" lesson, and the imported songs Oleander and Feel Good Inc. A feature's background work is a load in `LOADS` (it runs while the music plays); save a run with `--save name` and judge it with `--judge name --compare other`.

## The rule for a new feature
Counters that should stay at zero (skipped notes, underruns, stalls) must not rise. A cost (long-task time, longest task, CPU, frame time, heap growth) must not be more than 25% worse than the worst repeat of the run it is compared with, plus a small allowance
(30 ms long-task time, 25 ms longest task, 20 CPU ms/s, 5 frame ms/s, 5 MB heap) so tiny numbers do not trip it. The gate fails closed: a missing scenario, a counter measured before and not now, a run that was not playing or whose audio clock did not move, a load that did not start, or an empty result is a failure.
The margins were chosen from the run-to-run spread seen here, not from a standard; they are a provisional guess, not a proven musical safety budget.

## Correction (2026-11-26, handoff 0002 finding 7)
The first version of this page reported zero skipped notes, underruns and stalls everywhere. Those counters came from a panel that was read twice without refreshing, so they could not have changed; that conclusion is withdrawn. The harness was repaired, and **the repair is proven**:
a load that blocks the page for 600 ms in the middle of the window now shows up as skipped notes, a stall and a 600 ms long task, and the gate fails it.

| run | board | notes skipped | underruns | page stalls | long tasks (ms) | CPU ms/s | frame ms/s | heap growth MB |
|---|---|---|---|---|---|---|---|---|
| a deliberate 600 ms stall (self-test) | whole-song | 9 | 0 | 1 | 1 (600) | 257 | 45.8 | 0.8 |

## Results (2026-11-26, this Mac, headless Chrome, no speakers; 3 runs of 20 s per board, worst shown)
| run | board | notes skipped | underruns | page stalls | long tasks (ms) | CPU ms/s | frame ms/s | heap growth MB |
|---|---|---|---|---|---|---|---|---|
| idle (x-ray closed) | whole-song | 0 | 0 | 0 | 0 (0) | 240 | 54.6 | 0.6 |
| idle (x-ray closed) | oleander | 0 | 0 | 0 | 0 (0) | 359 | 200.3 | -1 |
| idle (x-ray closed) | feel-good | 0 | 0 | 0 | 0 (0) | 355 | 111.8 | -1.2 |
| x-ray open, forced to re-read every 0.5 s | whole-song | 0 | 0 | 0 | 0 (0) | 255 | 58.7 | -0.9 |
| x-ray open, forced to re-read every 0.5 s | oleander | 0 | 0 | 0 | 0 (0) | 371 | 206.5 | -0.5 |
| x-ray open, forced to re-read every 0.5 s | feel-good | 0 | 0 | 0 | 0 (0) | 413 | 124.6 | 1.3 |
| x-ray open, re-read every 2 s (steady editing) | whole-song | 0 | 0 | 0 | 0 (0) | 261 | 57.8 | -0.1 |
| x-ray open, re-read every 2 s (steady editing) | oleander | 0 | 0 | 0 | 0 (0) | 377 | 211.3 | -0.6 |
| x-ray open, re-read every 2 s (steady editing) | feel-good | 0 | 0 | 0 | 0 (0) | 412 | 123.9 | 0.5 |

- Idle playback skips nothing and runs dry never, on all three boards, and that now means something because the counters are shown to move.
- **The x-ray first had a real cost.** Before it learned to hold back while music plays, steady re-reading every 2 s cost real main-thread time on the heavier boards. In two repeated runs (same harness):

| run | board | notes skipped | underruns | page stalls | long tasks (ms) | CPU ms/s | frame ms/s | heap growth MB |
|---|---|---|---|---|---|---|---|---|
| x-ray every 2 s, before the throttle (run 1) | whole-song | 0 | 0 | 0 | 0 (0) | 320 | 71 | 1 |
| x-ray every 2 s, before the throttle (run 1) | oleander | 0 | 0 | 0 | 2 (114) | 602 | 326 | 0.2 |
| x-ray every 2 s, before the throttle (run 1) | feel-good | 3 | 3 | 1 | 2 (359) | 520 | 158.8 | -0.8 |
| x-ray every 2 s, before the throttle (run 2) | whole-song | 0 | 0 | 0 | 0 (0) | 283 | 65.4 | -0.3 |
| x-ray every 2 s, before the throttle (run 2) | oleander | 0 | 0 | 0 | 4 (263) | 660 | 361.3 | 7.9 |
| x-ray every 2 s, before the throttle (run 2) | feel-good | 0 | 0 | 0 | 1 (51) | 487 | 142.1 | 0.8 |

  Oleander's CPU rose from about 350 to 600+ ms/s with long tasks up to 87 ms; Feel Good had runs with skipped notes, underruns and a 200 to 360 ms long task. Run-to-run spread is large, so treat these as "real and variable".
- **The fix:** while the music plays, the x-ray stops updating on its own once a reading has proved slow (over 40 ms: a query runs on the same thread as the player and cannot be interrupted), keeps the last picture, says why, and offers a **Refresh** button. After the change, both loads pass the gate against idle on all three boards: no skipped notes, no underruns, no stalls, no long tasks, CPU within the allowance.
- The highest cost on every board is still frame time (the animated pictures): Oleander spends about 200 ms of every second inside animation frames with three piano-roll views drawing. A lighter piano roll is the first place to look if a slower computer struggles.

## Not measured
A phone, a slow or throttled computer, a long session, listening, dense expanded chains, long Takes, and a person editing live (the 2 s load re-reads on a timer; it does not change the patch). One fixed query repeated is a heavy load, not a universal worst case. These numbers are one machine's baseline, not guarantees.
