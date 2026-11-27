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

> The tables above were measured on earlier builds, before the 2-second reading gap, the cost accounting and the stricter gate described below. They are historical observations on one machine. Only the section below describes the current x-ray, and it is not a guarantee either.

## Re-measurement after handoff 0003 (2026-11-26)

Method as above, 15 s windows, 2 runs per board (3 for the Oleander re-run), new baseline `r3-idle`. Local, headless Chrome, one machine: a historical observation, not a safety proof.

- Idle playback: 0 skipped notes, underruns and stalls on whole-song, Oleander and Feel Good.
- `xray-edit` (the x-ray asked again every 2 s): all three boards pass against idle.
- `xray` (asked every 0.5 s, far busier than a person editing): the first run, with readings only slowed by the 40 ms rule, **failed** on whole-song (27 skipped notes, 1 underrun, 3 stalls). That is real harm, and it appeared because queue wait is no longer counted as query cost (0003 F9), so fewer readings looked slow. Fix: while the music plays, automatic readings are at least 2 s apart. After that, whole-song and Feel Good pass the stall counters; Feel Good's CPU and frame time stay above the 25% margin on one run; **Oleander skipped 4 notes with 2 stalls (one 286 ms task) in one of 5 runs** and was clean in the other 4 (3 of 3 in the Oleander-only re-run). The first reading after opening the panel, while music plays, is one unavoidable query that cannot be interrupted. So: the gate catches problems, and a heavy board can still have an occasional late note when the x-ray is first opened during playback.
- Deliberate stall (`stall` load, 600 ms): fails as it should (8 skipped, 1 stall, a 600 ms long task). A run with `--only` also fails because the other baseline scenarios are not measured, by design.
- The `xray` load calls the same pausable refresh the panel uses, so a pass can mean the readings paused, not that reading is free.
- Harness input checks: `--seconds -1`, `--repeat 1.5` and unknown loads are refused before Chrome starts.

## Cost of one reading on dense patterns (Node, `npm run bench:query`)

`scripts/bench-query.mjs` runs the real guard, evaluate, query and record path in Node, four cycles, median of 5 (not browser timing: it shows which shapes are expensive, and it is the first benchmark of dense admitted patterns).

| Pattern | Events | Median ms |
|---|---|---|
| 8-note melody | 32 | 1.4 |
| `bd*16 hh*16 sd*16` | 192 | 1.9 |
| `note("c3*16").ply(8).chop(32)` | 16,384 | 121 |
| `note("c3*4000")` | 16,000 | 44 |
| `s("hh*32").fast(8).chop(64)` | 50,000 (the record's cap) | 525 |
| superimpose + off + echo chain | 768 | 5 |
| 600-note Take over 61 bars | 40 | 9 |

What this shows: the guard admits patterns that cost half a second to read. Before this benchmark the x-ray would take such a reading in one go, on the thread that schedules notes. Now the x-ray first reads one cycle, and when that alone takes over 10 ms it keeps only that picture (and says so), which cuts the worst case to about a quarter. That is a mitigation, not a bound: a 1-cycle reading of the heaviest admitted pattern still takes about 130 ms. Not measured: the browser, a long Take with dense overlaps, live edits.

## The form map while music plays (2026-11-26)

Same method (15 s windows, 3 runs, baseline `r3-idle`, headless Chrome, one machine). The `formmap` load opens the song form map (32 cycles, every voice) and presses Read again every 3 s, far busier than anyone would use it.
- First version (8-cycle chunks, every chunk evaluated again): no skipped notes, but one 72 ms long task on whole-song and 6 to 20 MB of heap still held after a collection on every board.
- 4-cycle chunks removed the long tasks; the heap growth stayed (10 to 20 MB per window). The cause was evaluating the same voice many times (about 360 evaluations a window): each Strudel evaluation appears to keep some memory. Reading one voice in pieces from a single evaluation (`reuse` in `queryEvents`) brought it back inside the gate.
- Final: all three boards pass the gate against idle (0 skipped notes, underruns, stalls and long tasks; heap growth 3 MB or less).
- What it does not show: whether the memory per evaluation is released later (the window is short), so a very long session of repeated x-ray readings (one evaluation and two queries per reading) is still unmeasured; a form map on a board with many dense voices; a phone.

