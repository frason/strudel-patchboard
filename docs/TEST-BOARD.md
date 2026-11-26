# Test board: a tour of the newer features

The board is `tools/test-board.patchboard.json` (made by `scripts/make-test-board.mjs`). It is also the last lesson in the **Learn** menu, **34 · Feature test** (same board, kept in `src/featuretest.js` by the same script). Or load the file with **Import, Choose a file**. It has 9 labelled groups,
each a small chain for one feature. Groups 1 and 2 play when you press play; the rest start muted so you can try them one at a time: click the speaker button on a group's frame to unmute it, and mute the others.
If you change something and want it back, use Undo (Ctrl or Cmd Z) or load the file again.

## The groups

| # | Group | What to try | What you should see or hear |
|---|---|---|---|
| 1 | Mask + When (plays) | Change the Mask text to `1 1 0 1`. Change When's text to `<0 1>`, then its "then" choice to "up an octave". | Mask leaves gaps in the melody. When changes the notes in the cycles where its mask says 1. The code panel shows `.mask(...)` and `.when(...)` with a plain-English note beside each. |
| 2 | Iter (plays) | Change Iter's steps to 2, then set direction to back. | The four-note tune starts one step later each cycle (or earlier, going back) and returns to the start after N cycles. |
| 3 | Add notes, Superimpose, Off | Unmute. Change Add notes to `<0 5 7>`; change Superimpose's copy to "down an octave"; move Off's "later by". | A riff that moves through the numbers, with a copy an octave away and a shifted, transposed echo of the whole thing. |
| 4 | Jux | Unmute. Use headphones. Set width to 0.5. | The tune plays on one side and a reversed copy on the other; width below 1 narrows the gap. |
| 5 | Loop at + Chop | Unmute. Needs the `breaks` sample pack to download (the play button shows a progress bar the first time). Change Chop's pieces to 4 or 16, switch "how" to striate. | A drum loop fitted to 2 cycles, cut into slices. |
| 6 | Echo on drums | Unmute. Change times to 5 and volume to 0.7. | Each snare hit repeats, each repeat quieter. |
| 7 | Slow, two cables into one input | Unmute. Drag one of the two cables away, then drag it back. | Both note patterns play together, slowed the same. Plugging in something that is not notes is refused with a reason. Code: `stack(a, b).slow(2)`. |
| 8 | Fast, two cables into one input | Unmute. | The same for fast. |
| 9 | Chords with flats + DJ filter | Unmute. Read the warning on the DJ filter. Put an **Orbit** module (set to 2) in front of the DJ filter (right-click or use the module list, then connect it between the Instrument and the DJ filter). | Eb minor, Db, Ab minor 7, Bb 7 are written as D#m, C#, G#m7, A#7 (same notes). The DJ filter warns that it filters the whole orbit, drums included. With the Orbit module in front, the warning goes away. |

## Features that are not a group

- **Cable x-ray.** On any module press the three-dots menu, then **Show what comes out**. A panel pins to the screen: the events as that module leaves them, over four cycles, with a note about what is not included (later modules, master volume, Mixer). Edit a number upstream and the picture updates after a short pause. Close it with Close or Esc.
- **Copy for an AI chat.** Export menu, last item. Paste the result into any chatbot: how Patchboard works, the module list and this board's code.
- **Record the sound.** The red **rec** button next to play starts the piece and records to a WAV file; press it again to save.
- **Sample pack consent.** Import the file `tools/coastline.strudel` (Import, Choose a file). The import window offers to download the `github:eddyflux/crate` pack and the play button becomes a progress bar while it loads.
- **MIDI.** Import any `.mid` file: each track becomes a Take. (None is supplied.)
- **Strudel Code from strudel.cc.** Import `tools/feel-good.strudel` or `tools/oleander.strudel`.

## Things worth checking that are easy to miss
- Mute and unmute a whole group, then a single module inside it.
- Open the x-ray on the Instrument of group 1 while it plays, then edit the Mask text: playback should not stutter.
- In the code panel, change a number inside `.echo(3, 0.125, 0.5)` or `.off(0.125, ...)`: the module's knob follows.
- Move the Slow module in group 7 onto its own (disconnect one cable) and look at the code panel text change from `stack(...)` to a single pattern.

Playback was measured with `npm run perf:play`, but nobody has listened to this board on a phone or a slow computer; say what you hear.
