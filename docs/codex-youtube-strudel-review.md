# Review and design brief: audio → idiomatic Strudel

For: Codex, working on `experiments/youtube-strudel` (branch `codex/youtube-strudel`).
Written by: Claude, as an advisor. Nothing here was run, and no repository was modified.
Status: advice, not a specification. Every number marked "proposal" is a starting point to be tuned, not a known-good value.

---

## 0. Read this first: what is known, what is not

**I cannot hear the reference.** I have no access to the audio of the video, and I did not process any audio while writing this. I make no claim about what is in the passage (tempo, groove, instruments, bass notes, anything). Every statement about the specific track would be invention, so there are none below.

**I cannot verify the models.** The prompt mentions "Gemini 4 Hydrogen" and "Gemini 3.5 Flash-Lite". I do not know their capabilities or limits. Treat any claim about what they can hear as unverified until tested (section 2).

**I cannot verify tools or APIs by running them.** The tools below exist as I know them, but I have not installed or run them here. The Strudel function names are from memory. Check each against the documentation for the version in the project before relying on it (appendix B lists them).

### 0.1 Observed facts, estimates and substitutions (from the original request)

| Kind | Statement | Status |
|---|---|---|
| Observed (reported by the owner) | Gemini 4 Hydrogen repeatedly returned HTTP 503 high-demand errors | reported, not reproduced here |
| Observed (reported) | Gemini 3.5 Flash-Lite processed the passage and returned a sketch | reported |
| Model claim | Tempo about 120 BPM | **unverified** |
| Model claim | Four-on-the-floor kick, backbeat snare, uniform sixteenth-note hats | **unverified**, and the "uniform" part is suspicious because real hats rarely are |
| Model claim | Repetitive C/G bass line | **unverified** |
| Observed (from the code description) | Fixed sixteenth grid, one slot per pitched event, one gain per track, four drum sounds, four oscillators, prompt encourages simplification | design limits of the prototype |
| Creative substitution (by construction) | Any choice of drum sample, oscillator, envelope or filter in the output | not derived from the audio unless a measurement says so |

The central problem follows from this table: **today nothing in the pipeline separates an observation from a substitution.** The first fix is to make that separation part of the data (sections 3 and 4).

---

## 1. Principles

1. **Measure, then interpret.** Timing and pitch come from signal analysis. A language model interprets (feel, idiom, naming, variation labels) and critiques. It should not be the source of onset times or pitches.
2. **Every field carries provenance.** One of `measured`, `inferred`, `model-claimed`, `assumed`, `creative`. The compiler may use any of them, but the output comments say which.
3. **Fidelity before beauty.** Build the lossless representation first. Simplification is a separate, reported compiler pass, never a hidden effect of the prompt.
4. **Expression only when supported.** Dynamics, microtiming and swing are emitted when the data shows a consistent pattern. Random "humanization" is not allowed to stand in for measured feel.
5. **Everything is a test.** Valid code and a successful API call are not evidence of listening. Evidence is agreement with measurements and with known answers (section 7).
6. **Reproducible.** Pin versions, cache inputs and outputs by hash, record which model produced which field.

---

## 2. Telling real listening from plausible guessing

A model given a YouTube URL does not give you the waveform. You cannot check what audio it received, and a model can answer from the title, metadata, a transcript or its prior knowledge of what a genre sounds like. A confident, well-formed answer is exactly what a guess looks like.

### 2.1 The test battery (run these before trusting any model stage)

| Test | Procedure | What a listening model does | What a guessing model does |
|---|---|---|---|
| **Sensitivity (offset)** | Run the same clip at 0–20 s and at 20–40 s | The sketch changes where the music changes | Near-identical output |
| **Null input** | Silence, white noise, a sine tone | Reports silence, noise, no drums | Invents a groove |
| **Swap** | Same prompt, a different song with a known tempo | Tempo and feel follow the new audio | Same answer as before |
| **Time stretch** | The same clip at ±5% speed (pitch preserved) | Tempo scales by about the same percent, pitches unchanged | Tempo unchanged |
| **Pitch shift** | The same clip transposed ±2 semitones (tempo preserved) | Bass pitches move by about that interval | Pitches unchanged |
| **Evidence** | Require a time in seconds for every event | Times line up with measured onsets within tolerance | Times are tidy grid multiples, or drift from the signal |
| **Consistency** | Run the same input N times at non-zero temperature | Stable tempo and drum pattern | Wide variation |
| **Calibration** | Compare self-reported confidence with correctness | Confidence correlates with accuracy | Uniformly high confidence |
| **Round trip** | Synthesize a known Strudel pattern, render audio, analyse it | Recovers the pattern within metrics | Returns the genre default |

These tests are **metamorphic**: they do not need the true answer, only the correct direction of change. The first four can be done today with ffmpeg and a few clips.

### 2.2 Interpretation rules for the results

- A model that passes sensitivity and fails evidence is hearing something but cannot time it. Use it for descriptions only.
- A model that fails the null-input test is not safe as a transcription source, whatever it does on real music.
- Record each result with date, model name, version if available, prompt hash and clip hash. Re-run when the model changes.

### 2.3 Honest labelling in the output

Until a measured stage exists, the generated file should start with a block like:

```js
// SOURCE: model-claimed only. No audio measurement was available.
// Tempo, rhythm and bass notes are unverified estimates.
```

and switch to a different block when measurements back the values.

---

## 3. Analysis workflow

### 3.0 Getting audio

A URL alone cannot be measured. Options, in order of preference:
1. A clip the user supplies (upload or local file) that they have the right to analyse.
2. Audio obtained by a method the user is entitled to use. Note that downloading from YouTube with common tools can conflict with the site's terms of service, and publishing a close transcription of a commercial recording has its own copyright considerations. Keep the experiment local and for study, and make the user choose the input.
3. The model's own URL ingestion: usable for description and critique, **not** for measurement or the tests above.

Normalize the clip: mono and stereo copies, 44.1 or 48 kHz, peak-normalized, with a short pad before and after the passage so edge onsets are not clipped. Store the SHA-256 of the analysis file.

### 3.1 Stages

Each stage writes a typed result with provenance, confidence and the tool version.

| # | Stage | Output | Tools (candidates, unverified here) | Failure modes to detect |
|---|---|---|---|---|
| 1 | **Tempo and beats** | beat times, tempo estimate, stability, half/double ambiguity | librosa beat tracker, madmom, essentia | half or double tempo; drift in live drums; tempo changes |
| 2 | **Downbeat and meter** | downbeat time, beats per bar, confidence | madmom downbeat tracking, or accent analysis on the low band | wrong bar phase (everything shifted by a beat) |
| 3 | **Stem separation** | drums, bass, other, (vocals) stems | Demucs | bleed between stems, artifacts on hats and kick |
| 4 | **Drum onsets** | onset times per band, strengths | librosa onset detection on band-split drum stem | flams read as two hits, missed ghost notes |
| 5 | **Drum classification** | role per onset: kick, snare, closed hat, open hat, rim, tom, other perc | simple spectral features plus clustering, or a trained drum transcription model | hats vs shaker; kick vs bass bleed |
| 6 | **Ghost notes and accents** | per-hit relative velocity, ghost flag | onset strength / RMS relative to neighbours | threshold choice; compression flattening dynamics |
| 7 | **Bass pitch tracking** | f0 contour from the bass stem | pYIN (librosa), CREPE, basic-pitch | octave errors, glides, sub-bass energy below the tracker's range |
| 8 | **Bass segmentation** | note events: pitch, onset, duration, level, slide | segment f0 by pitch stability and amplitude | legato notes merged, repeated notes merged |
| 9 | **Timing analysis** | per-event residual from the grid, swing estimate | compare onsets to the beat grid subdivision | grid wrong, so "microtiming" is really a wrong grid |
| 10 | **Timbre descriptors** | kick sub frequency and decay, snare tone vs noise, hat decay, bass brightness | spectral centroid, decay time, band energy | bleed; reverb tails |
| 11 | **Bar structure** | bars clustered by similarity; variations and fills labelled | compare bar-level event signatures | tolerance too tight (every bar differs) or too loose |
| 12 | **Model interpretation** | feel, idiom, naming, variation commentary, critique | an audio-capable model **with the measurements in its context** | it overrides measurements; check against stage outputs |

### 3.2 Rules for the stages

- **Report disagreement, do not hide it.** If the model's tempo and the beat tracker's tempo differ, print both and which was used.
- **Half/double tempo:** keep both candidates with their support. Choose by the drum pattern's plausibility (snare on 2 and 4 at one tempo means snare on 1 and 3 at double) and say so.
- **Quantization is a separate, reversible pass.** Store the raw time and the residual. Never overwrite the measurement.
- **Ghost notes need an explicit rule**, for example "an onset below X% of the neighbouring accent's strength and in the snare band". The rule and threshold go into the output comment.
- **Use the drum stem and the bass stem separately.** Do not ask the model to separate layers from a full mix in one step.

### 3.3 What can realistically work

- **URL only, no audio file:** description and rough guesses. No verification. Label output as unverified.
- **Audio file, CPU only:** all stages above are feasible for 20 seconds. Stem separation is the slowest.
- **Browser only:** onset and tempo work are possible (for example with essentia.js or Meyda, unverified), but stem separation and bass transcription are impractical. A small local Python service is the realistic route.

---

## 4. Intermediate representation (IR)

Replace the fixed sixteenth grid with an event list that keeps the measurement, the quantized position and the residual.

### 4.1 Requirements

- Time in absolute seconds **and** position in the bar.
- A quantization grid that supports triplets (for example 48 slots per 4/4 bar, which divides into 16ths and 12ths) or an arbitrary rational.
- Per event: velocity, duration, confidence, provenance, evidence.
- Pitch in MIDI plus cents deviation for bass; slides as events.
- Bar-level structure: which bars repeat, which vary and how.
- A list of things the compiler dropped or could not represent.

### 4.2 Sketch (field names are proposals)

```json
{
  "schema": "ys-ir/2",
  "source": {
    "kind": "youtube",
    "id": "7SfFInoSotg",
    "startSec": 0,
    "endSec": 20,
    "analysisAudioSha256": null
  },
  "provenanceLegend": ["measured", "inferred", "model-claimed", "assumed", "creative"],
  "tempo": {
    "bpm": null,
    "candidates": [{ "bpm": null, "support": null }],
    "stability": { "driftPct": null },
    "confidence": null,
    "provenance": "measured",
    "method": "tool@version"
  },
  "meter": {
    "beatsPerBar": 4,
    "downbeatSec": null,
    "confidence": null,
    "provenance": "measured"
  },
  "grid": {
    "slotsPerBar": 48,
    "swing": { "ratio": null, "evidence": "per-slot residual statistics", "provenance": "measured" }
  },
  "bars": [
    { "index": 0, "startSec": null, "endSec": null,
      "signature": "hash of quantized events",
      "sameAs": null, "variationOf": null, "variationNotes": [] }
  ],
  "tracks": [
    {
      "id": "kick",
      "family": "drum",
      "role": "kick",
      "timbre": {
        "descriptors": { "subHz": null, "decaySec": null },
        "chosenSound": { "name": "bd", "bank": null, "provenance": "creative" },
        "alternatives": [],
        "distance": null
      },
      "events": [
        { "id": "k0", "tSec": null, "bar": 0, "slot": 0, "residualMs": null,
          "velocity": null, "durSec": null, "articulation": null,
          "confidence": null, "provenance": "measured",
          "evidence": { "detector": "low-band onset", "strength": null } }
      ]
    },
    {
      "id": "bass",
      "family": "pitched",
      "role": "bass",
      "events": [
        { "id": "b0", "tSec": null, "bar": 0, "slot": 0, "residualMs": null,
          "pitchMidi": null, "pitchCents": null, "durSec": null,
          "velocity": null, "slideToMidi": null,
          "confidence": null, "provenance": "measured" }
      ]
    }
  ],
  "dropped": [],
  "uncertainties": [
    { "field": "tempo.bpm", "why": "half/double ambiguity", "candidates": [] }
  ]
}
```

### 4.3 Invariants the validator should enforce

- Every event has a provenance and a confidence in [0, 1].
- `slot` is an integer in [0, slotsPerBar), and `tSec` is consistent with the tempo, downbeat and slot within a stated tolerance.
- Pitched events do not overlap on a monophonic track unless explicitly marked as polyphonic.
- A `measured` event must carry an `evidence` object.
- `creative` fields must not appear in the fidelity metrics (section 7).
- No field is silently defaulted: an unknown value is `null` with an entry in `uncertainties`.

---

## 5. Compiler strategy

The compiler stays deterministic and testable. It is a series of passes, and each pass can be turned off for debugging.

### 5.1 Passes

1. **Validate and normalize** the IR.
2. **Segment into bars** using the downbeat and tempo.
3. **Quantize** each event to the grid, keeping the residual. Report events that quantize to a slot already taken.
4. **Build full-fidelity bar strings** per track, with no compression yet.
5. **Detect motifs.** Hash each bar's quantized signature. Group exact repeats first, then near repeats by a weighted edit distance (a missing ghost note costs less than a missing backbeat). Output the motif A, B, C... and the order they occur in.
6. **Emit compact patterns:** repeats with `!` or `*`, alternating bars with `<A B>`, fills as one-off bars, long durations with `@` or ties.
7. **Attach dynamics** as a separate pattern with the same step structure as the notes. Add a check that the two patterns have the same number of steps.
8. **Apply the timing policy** (5.3).
9. **Write comments** from provenance (5.4).
10. **Produce the "dropped nuance" report** for anything the output could not carry.
11. **Self-check:** evaluate the emitted Strudel in a test harness and compare its events with the quantized IR. Fail the build if they differ.

### 5.2 Mini-notation tools to use (verify each against the docs)

| Need | Construct (to verify) |
|---|---|
| Rests | `~` |
| Grouping and subdivision | `[ ]` |
| Repeat a step | `*n` or `!n` |
| Alternate per cycle | `<a b>` |
| Hold a step longer | `@n`, or `_` for ties |
| Layers | `,` inside a pattern, or `stack(...)` |
| Euclidean rhythms | `euclid` or `(k,n)` in mini-notation, only if the data really is Euclidean |
| Probability | `?` and `degradeBy` — **do not use for fidelity**; they add randomness |

Using triplet-capable structure: a bar of 48 slots can be written with nested brackets (`[a b c]` triplets inside a beat). Prefer the simplest notation that preserves the timing.

### 5.3 Microtiming and swing policy

- Compute, per track and per slot class (on-beat, off-beat 8th, 16th positions), the median residual and its spread.
- **Emit a track-level offset** (for example Strudel's `late`/`early`, units to verify) only when the median is consistent: small spread relative to its magnitude, and present over most of the passage.
- **Emit swing** only if the off-beat slots are consistently late by a similar amount. Compare with Strudel's swing function (verify name and arguments) and keep the measured ratio in a comment.
- **Per-event offsets** are not expressible compactly. List them under "dropped nuance" with the largest residuals, instead of faking them.
- **No random jitter.** If the data shows none, emit none.

### 5.4 Comment policy

Every block says what the evidence is. For example:

```js
// Hats: 16th grid, 3 velocity levels.
// measured: onset times (drum stem, band 6-12 kHz). inferred: open vs closed by decay.
// assumed: sound "hh" from the default set. dropped: per-event timing under 8 ms.
```

Keep comments short, but never omit the provenance line.

### 5.5 Bass

- Pitch comes from the tracker as MIDI note names. Keep octave decisions visible (octave errors are common).
- Durations as `@` steps or `.legato`/`.clip` (verify). Slides only if measured; otherwise note them as dropped.
- Choose the synth sound by timbre descriptors (brightness, decay) against a small set of candidate sounds, and report the distance. This is a `creative` substitution, and the comment should say so.

### 5.6 Example of intent (illustrative only, not derived from any audio)

```js
// ILLUSTRATION: shows structure and comment style. The values mean nothing.
setcpm(0/4)  // measured: tempo (tool@version). Replace 0 with the measured value.

$: s("bd ~ ~ ~ bd ~ ~ ~")           // measured: kick onsets, bars A
$: s("~ sd ~ sd").gain("1 .9")      // measured: snare + level pattern; inferred: accent
$: note("<c2@3 g1 ~ c2>").s("sawtooth")  // measured: bass; creative: sound choice
```

Do not copy this as a result. It exists to show comment placement and compactness.

---

## 6. Tools, models and what to combine

| Option | Strengths | Weaknesses | Use it for |
|---|---|---|---|
| **Audio-capable LLM alone** | Cheap to try, handles description, idiom and critique | Weak at exact timing and pitch; unverifiable from a URL; can hallucinate precision; 503s | interpretation, naming, critique, A/B commentary |
| **Beat and onset tools** | Real timing; reproducible | No musical meaning | stages 1, 2, 4, 9 |
| **Stem separation** | Isolates drums and bass, making later steps easier | Artifacts; slow on CPU; bleed | stage 3 |
| **Pitch tracking and note transcription** | Real bass pitches and durations | Octave errors, glides, polyphony | stages 7, 8 |
| **Hybrid (recommended)** | Measured facts plus interpretation | More moving parts | all |

**Recommendation:** hybrid. Tools produce the facts. The model receives those facts (and, where possible, the audio) and is asked to interpret and to find disagreements, not to produce timings.

**Infrastructure:** a small local Python service (or CLI) producing the IR's measured fields, called from the Node app. Cache outputs by clip hash. Keep model calls behind a retry layer: exponential backoff with jitter on 503, a documented fallback model, a cache keyed on (clip hash, offsets, model, prompt hash), and a field in the output recording which model produced which field, so a silent fallback cannot change quality unnoticed.

---

## 7. Evaluation and refinement

### 7.1 Levels

| Level | Question | How |
|---|---|---|
| **L0 Compiler** | Does the code say what the IR says? | Emit, evaluate in Strudel, compare events to the quantized IR (exact match required) |
| **L1 Synthetic round trip** | Can the pipeline recover a pattern it has no prior for? | Generate known patterns, render audio, run the pipeline, score |
| **L2 Reference comparison** | Does the output resemble the real passage? | Render the Strudel output and compare with the source per stem |
| **L3 Human A/B** | Do listeners hear the identity? | Blind comparison of conditions |

### 7.2 Synthetic corpus (L1)

Generate parameterized patterns and render them (Strudel's own render, or any synth). Vary independently:
- tempo (slow, mid, fast, plus a half/double trap)
- swing amount, including none
- ghost-note velocity relative to accents
- humanization jitter (a few ms vs tens of ms)
- bass note length (staccato vs legato), repeated notes, glides
- drum layering (kick plus a layered clap or rim)
- fills in the last bar of a phrase
- mix conditions: added noise, reverb, light compression

Then run the **metamorphic controls** from section 2 on the same files, and the **null inputs**.

### 7.3 Metrics (definitions; `mir_eval` provides several of these)

| Aspect | Metric | Note |
|---|---|---|
| Onsets | precision, recall and F-measure with a tolerance window (proposal: 30 ms, also report 50 ms) | per drum role |
| Tempo | accuracy within a few percent; accuracy allowing half/double, reported separately | do not hide half/double errors |
| Beats and downbeat | beat F-measure; downbeat accuracy | catches shifted bar phase |
| Drum roles | confusion matrix | where kick/bass bleed shows up |
| Bass notes | note F1 on onset only, and onset plus duration (proposal: 50 ms, 50 cents) | |
| Pitch | median absolute pitch error in cents on matched notes | |
| Dynamics | correlation between measured and emitted relative velocity | |
| Microtiming | mean absolute error of emitted vs measured residual | compare against emitting none |
| Structure | agreement of bar clusters with the true bar clusters | e.g. adjusted Rand index |
| Compactness | characters, number of unique motifs, and compression ratio vs the expanded string | readability proxy only |
| Spectral (L2) | multi-resolution spectral distance or log-mel distance, per stem | **not** a musical-similarity score; sample choice will differ; use as a smoke test |
| Envelope (L2) | envelope correlation per band | catches wrong dynamics |

Set pass thresholds **before** looking at results, on the synthetic corpus. Report the baseline (the current prototype) on the same corpus first. Without that number, "better" cannot be shown.

### 7.4 Human A/B (L3)

Conditions: (A) the current prototype, (B) the measured pipeline, (C) the measured pipeline plus labelled creative substitutions. Blind, randomized order. Ask per item: which is closer to the reference for drums, for percussion, for bass; confidence; free text on what is missing. Record who, when and versions. Keep it small and honest: it supports the metrics, it does not replace them.

### 7.5 Refinement loop

1. Run the pipeline on a clip.
2. Produce a **diff report**: missed hits, extra hits, role confusions, pitch errors, structural disagreements, each with times.
3. Fix **deterministically** first (a threshold, a missing detector, a wrong grid).
4. Use the language model only for judgments the data cannot settle, with the diff report as context.
5. Re-run all levels. Accept a change only if no metric regresses beyond a stated margin.
6. Stop when the metrics plateau; write the remaining gaps into the output's comments.
7. Keep a ledger: change, reason, metrics before and after.

---

## 8. Next iteration and roadmap

### 8.1 Smallest useful next iteration

1. **Schema:** add provenance, confidence and an `uncertainties` list to the current JSON, and a top-level "unverified" flag.
2. **Prompt:** replace "simplify" with "list every audible event with a time in seconds, a confidence and a provenance; do not invent; say 'unknown' when unsure" (a draft is in appendix A).
3. **Quantizer:** accept event times and quantize deterministically on a triplet-capable grid, so the model no longer has to place events on slots.
4. **Measured baseline:** run one beat/onset tool on a local copy of the clip. Print a disagreement table (model tempo vs measured, model hits vs measured onsets). If no audio file is available, mark the whole output unverified.
5. **Test harness:** the L0 compiler test and a minimal L1 round trip with a handful of synthetic patterns and the null/shift/stretch controls.
6. **Retry layer** for 503s with caching and model-provenance recording.

**Acceptance for iteration 1:** the harness runs; the null-input and time-stretch controls give the expected direction of change or a recorded failure; the output states clearly which values are measured; the baseline metrics for the old prototype are recorded.

### 8.2 Iteration 2

Stem separation, drum role classification, ghost/accent detection, bass tracking and segmentation, microtiming statistics, motif detection and compact emission.

### 8.3 Longer-term design

- A viewer that overlays measured events on the generated pattern (piano roll), so differences are visible.
- Timbre matching to Strudel sounds with a reported distance, and a short list of alternatives.
- Optional model critique stage that compares two renders against the source and lists differences (appendix A).
- Optional link to Strudel Patchboard (the main project): its importer reads a defined subset of Strudel and reports what it cannot show. Running generated code through it is a cheap way to check "can this be edited visually" and to list unsupported lines. This is read-only use of that code; do not modify the main checkout. Current status of the timing and dynamics functions in Patchboard (checked in the code): `velocity`, `late`, `early` (read as a negative `late`), `swingBy` and `swing` (read as `swingBy(1/3, n)`) are supported, so they load onto the board as modules, are played, and can be edited by knob or by typing. `clip` and `legato` are supported too (in Strudel they are two names for one control that multiplies each event's length; Patchboard reads either name into a "Note length" module and writes `.clip(n)`, with n from 0 to 4). Note lengths can also be written per step with `@` in mini-notation (for example `c3@2`); I did not check whether `_` ties are supported.
- A regression suite of clips (user-supplied, rights-cleared) with stored measurements.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The model hears a genre and returns its template | Evidence requirement, controls from section 2, measured baseline |
| Tools disagree with each other | Report disagreement; do not average silently |
| Wrong grid makes microtiming meaningless | Validate the grid against the beat tracker before emitting any offset |
| Over-fitting to one passage | Synthetic corpus plus several unrelated clips |
| Metric gaming (spectral match with the wrong notes) | Use several metrics; L3 listening; report all |
| Sample mismatch (the Strudel kick is not the recording's kick) | Treat timbre as `creative`; report descriptor distance; do not score it as fidelity |
| API instability and cost | Cache, retry, fallback model labelled in output |
| Copyright and terms of service | User-supplied or rights-cleared audio; local study use; user decides what is published |
| Unreadable generated code | Compactness metric; motif passes; keep comments short |

---

## 10. Open questions for the owner

1. Is an audio file available for the passage, or is URL-only a hard constraint? (This decides whether anything can be measured.)
2. What counts as success: audible resemblance, an editable starting point, or measured agreement? The metrics should follow.
3. How much of the output should be creative substitution versus strictly measured?
4. Python sidecar acceptable, or must it stay Node/browser?
5. Should the result load into Strudel Patchboard, which would constrain the Strudel subset used?

---

## Appendix A: prompt drafts

### A.1 Evidence-first extraction (audio-capable model)

```text
You are given an audio clip of {start}–{end} seconds. Describe only what you can
actually hear in this clip. Do not use the title, channel, genre or any prior
knowledge about the song. If you cannot tell, say "unknown".

Return JSON with these fields. For every event give a time in seconds from the
start of the clip, a confidence in [0,1], and a short evidence phrase.

- tempo: bpm estimate, a second candidate if half/double is possible, and why
- downbeat: time in seconds of the first bar's downbeat, confidence
- drums: list of events {t, role in [kick, snare, closed_hat, open_hat, rim, tom, other],
  relative_velocity 0..1, confidence, evidence}
- percussion: same shape, role free text
- bass: list of notes {t, duration, pitch as note name with octave, confidence}
- bar_variations: which bars differ from which, and how
- uncertainties: everything you are unsure about

List every audible event, including quiet ones. Do not simplify. Do not invent
events to complete a pattern. Prefer "unknown" to a guess.
```

### A.2 Critique (A/B against measurements)

```text
You are given: (1) the original clip, (2) a rendering of a generated Strudel
pattern, and (3) a table of measured onsets and tempo from signal analysis.
List the audible differences between (1) and (2), grouped by drums, percussion
and bass. For each, say whether the measurement table supports it. Do not
propose changes that contradict the measurements. Do not comment on mix level.
```

## Appendix B: Strudel features to verify before use

Check each name and its argument units against the documentation for the installed version. Do not assume they are as written here.

- Time shifting: `late`, `early` (units: cycles or something else?)
- Swing: `swingBy`, `swing`
- Dynamics: `gain`, `velocity`, `postgain`
- Note length: `legato`, `clip`, `sustain`
- Layering: `stack`, `cat`, `arrange`, `struct`, `mask`
- Mini-notation: `~`, `[ ]`, `< >`, `*`, `/`, `!`, `@`, `_`, `?`, `,`, Euclid syntax
- Sound selection: `s`, `bank`, `note`, `n`
- Tempo: `setcpm`, and how cycles-per-minute relates to beats per minute and beats per cycle

## Appendix C: glossary

- **Provenance:** where a value came from (measured, inferred, model-claimed, assumed, creative).
- **Residual:** the signed difference between a measured event time and its quantized grid position.
- **Metamorphic test:** a test with no known answer, checking only that a known change to the input (stretch, shift) produces the right change in the output.
- **Motif:** a bar-sized pattern that repeats exactly or approximately.
- **Round trip:** synthetic pattern → audio → analysis → pattern, compared with the original.
