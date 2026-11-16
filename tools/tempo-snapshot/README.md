# tempo-snapshot

Measure the tempo of a short audio clip and draw a picture of its rhythm, so a tempo estimate (yours, a model's, a script's) can be checked by eye.
Standard library only; decoding uses macOS `afconvert` or `ffmpeg` if either is installed, or give it a `.wav`.

```bash
python3 tools/tempo-snapshot/tempo_snapshot.py clip.m4a --compare 128
python3 tools/tempo-snapshot/tempo_snapshot.py clip.m4a --grid 125 --compare 128 --out check.png --json report.json
```

Reading the picture: four curves show where the sound suddenly gets louder (all bands, then low = kick and bass, mid, high = hats and snare air). The teal
lines are the best-fitting beat grid (thicker every 4th beat; which beat is the bar's "1" is not found). Each `--compare` tempo gets its own strip under the curves:
if it slides away from the teal strip, that tempo drifts against the recording.

Limits: loudness only, nothing is listened to. Half and double tempo cannot be told apart by timing (the script prints both), sparse or very syncopated music can
fool it, and a score is a relative measure of fit, not a probability. Treat it as evidence to look at, not an answer.
