# Playback performance

Performance is the first gate for new features (docs/ROADMAP.md section 7; handoff 0001, finding F1). This is how it is measured and where it stands.

## Method
`npm run build && npm run perf:play` (`scripts/perf-play.mjs`, plumbing in `scripts/cdp.mjs`). It loads the production build in headless Chrome, presses play on real boards,
waits 7 s for the sounds to download, then measures a 20 s window, three times per board, and reports the **worst** of the three:
- **notes skipped**, **audio underruns** and **page stalls over 0.15 s** (the app's own audio-health counters, read from Settings);
- **long tasks** (the browser's own report of main-thread work over 50 ms), CPU time per second, time spent in animation frames, and **heap growth after a garbage collection**.
Boards: the "whole song" lesson, and the imported songs Oleander and Feel Good Inc. Add a feature's background work as a load in `LOADS` (it runs while the music plays), save the run
with `--save name`, and judge it with `npm run perf:play -- --judge name --compare other`.

## The rule for a new feature
Counters that should stay at zero (skipped notes, underruns, stalls) must not rise. A cost (long-task time, longest task, CPU, frame time, heap growth) must not be more than 25% worse than
the worst repeat of the run it is compared with, plus a small allowance (30 ms long-task time, 25 ms longest task, 20 CPU ms/s, 5 frame ms/s, 5 MB heap) so tiny numbers do not trip it.
These margins were chosen from the run-to-run spread seen here, not from a standard; revise them with data.

## Results (2026-11-26, this Mac, headless Chrome, no speakers)
| run | board | notes skipped | underruns | page stalls | long tasks (ms) | CPU ms/s | frame ms/s | heap growth MB |
|---|---|---|---|---|---|---|---|---|
| before the x-ray (old build) | whole-song | 0 | 0 | 0 | 0 (0) | 236 | 55.2 | n/a |
| before the x-ray (old build) | oleander | 0 | 0 | 0 | 0 (0) | 383 | 211.8 | n/a |
| before the x-ray (old build) | feel-good | 0 | 0 | 0 | 1 (73) | 433 | 129.4 | n/a |
| new build, x-ray closed | whole-song | 0 | 0 | 0 | 0 (0) | 253 | 59.3 | -0.5 |
| new build, x-ray closed | oleander | 0 | 0 | 0 | 0 (0) | 343 | 191.7 | 1.1 |
| new build, x-ray closed | feel-good | 0 | 0 | 0 | 1 (53) | 362 | 108.4 | 1 |
| new build, x-ray open and reading every 0.5 s | whole-song | 0 | 0 | 0 | 0 (0) | 227 | 48.5 | 0.6 |
| new build, x-ray open and reading every 0.5 s | oleander | 0 | 0 | 0 | 0 (0) | 342 | 191 | 0.9 |
| new build, x-ray open and reading every 0.5 s | feel-good | 0 | 0 | 0 | 0 (0) | 271 | 81.1 | -0.5 |

- The **cable x-ray** was stressed far beyond normal use: reading the pinned module's pattern every 0.5 s whether or not its code changed (a person editing does not come close). Playback was **no worse** than the same build with the x-ray closed, on all three boards.
- The old build's heap figures were taken without a collection first and are not comparable (shown as n/a); every other column is.
- **Observation:** the highest cost on every board is frame time (the animated pictures), not the music: Oleander spends about 190 ms of every second inside animation frames, with three piano-roll views drawing. Nothing was skipped, but a lighter piano roll (or fewer redraws while playing) is the first place to look if a slower computer struggles.
- Not measured: a phone, a slow computer, long sessions, or listening. Headless Chrome has no speakers, so this shows timing, not sound. These numbers are one machine's baseline, not guarantees.
