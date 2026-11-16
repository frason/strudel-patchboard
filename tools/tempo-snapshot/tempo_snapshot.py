#!/usr/bin/env python3
"""Measure the tempo of a short audio clip and draw a picture of its rhythm. Standard library only.

    python3 tools/tempo-snapshot/tempo_snapshot.py clip.m4a                    # prints the analysis, writes clip-rhythm.png
    python3 tools/tempo-snapshot/tempo_snapshot.py clip.wav --compare 128 --out check.png
    python3 tools/tempo-snapshot/tempo_snapshot.py clip.wav --json report.json

What it does (all of it measured from the loudness of the recording, nothing is listened to):
  1. decodes the clip to mono 22.05 kHz (macOS afconvert, or ffmpeg if installed; a .wav is read as it is),
  2. splits it into three bands (low = kick and bass, mid, high = hats and snare air) and finds where each band gets suddenly louder,
  3. scores beat grids from 45 to 250 BPM against those onsets, then refines around the best ones, and checks the first and second half separately,
  4. draws a PNG: the onset curves, the best beat grid (teal) over them, and one strip per --compare tempo so a wrong tempo is visible as drift.

Limits: loudness only. Sparse or very syncopated music can fool it, half and double tempo cannot be told apart by timing alone,
and which beat is the bar's "1" is not found. Read the picture, do not just trust the number.
"""
import argparse, array, json, math, os, shutil, struct, subprocess, sys, tempfile, wave, zlib

HOP = 256

def decode(path):
    if path.lower().endswith('.wav'):
        return path, None
    tmp = tempfile.mkdtemp(prefix='tempo-snapshot-'); out = os.path.join(tmp, 'clip.wav')
    if shutil.which('afconvert'):
        cmd = ['afconvert', '-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', path, out]
    elif shutil.which('ffmpeg'):
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '22050', out]
    else:
        sys.exit('Cannot decode this file: install ffmpeg, use macOS (afconvert), or give a .wav file.')
    subprocess.run(cmd, check=True)
    return out, tmp

def read_wav(path):
    w = wave.open(path); fs = w.getframerate(); ch = w.getnchannels(); n = w.getnframes()
    x = array.array('h'); x.frombytes(w.readframes(n))
    if w.getsampwidth() != 2: sys.exit('Only 16-bit WAV is supported.')
    if ch > 1: x = array.array('h', (sum(x[i:i + ch]) // ch for i in range(0, len(x), ch)))
    return fs, [v / 32768 for v in x]

def lowpass(sig, fc, fs):
    a = 1 - math.exp(-2 * math.pi * fc / fs); y = 0.0; out = []
    for v in sig:
        y += a * (v - y); out.append(y)
    return out

def onsets(sig, fs):
    env = [sum(abs(v) for v in sig[i:i + HOP]) / HOP for i in range(0, len(sig) - HOP, HOP)]
    lg = [math.log(1e-5 + v) for v in env]
    sm = [(lg[max(0, i - 1)] + lg[i] + lg[min(len(lg) - 1, i + 1)]) / 3 for i in range(len(lg))]
    o = [0.0] + [max(0.0, sm[i] - sm[i - 1]) for i in range(1, len(sm))]
    m = max(o) or 1.0
    return [v / m for v in o]

def bands(x, fs):
    low = lowpass(lowpass(x, 150, fs), 150, fs)
    l2 = lowpass(lowpass(x, 2000, fs), 2000, fs)
    high = [a - b for a, b in zip(x, l2)]
    mid = [a - b for a, b in zip(l2, lowpass(x, 150, fs))]
    O = {'low': onsets(low, fs), 'mid': onsets(mid, fs), 'high': onsets(high, fs)}
    s = [a + b + c for a, b, c in zip(O['low'], O['mid'], O['high'])]; m = max(s) or 1.0
    O['all'] = [v / m for v in s]
    return O

def grid_score(o, fr, bpm, lo=0, hi=None):
    """How well a beat grid at `bpm` lands on the onsets: (z-score of the mean onset strength at the beats, best first-beat frame)."""
    o = o[lo:hi]; P = fr * 60 / bpm; mean = sum(o) / len(o); sd = (sum((v - mean) ** 2 for v in o) / len(o)) ** .5 or 1.0
    best = (-9.0, 0.0); ph = 0.0
    while ph < P:
        t = ph; tot = 0.0; cnt = 0
        while t < len(o) - 1:
            i = int(round(t)); tot += max(o[max(0, i - 1):i + 2]); cnt += 1; t += P
        if cnt >= 4: best = max(best, ((tot / cnt - mean) / sd, ph))
        ph += 0.5
    return best

def png(path, W, H, img):
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in img)
    def chunk(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

FONT = {'0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111'}

def draw(path, O, fr, dur, best_bpm, best_phase, compares):
    W = 1720; X0 = 10; PPS = (W - 20) / dur
    rows = [('all', (235, 235, 235), 190), ('low', (255, 160, 70), 90), ('mid', (110, 210, 120), 90), ('high', (100, 160, 255), 90)]
    H = 20 + sum(h + 8 for _, _, h in rows) + 32 * (1 + len(compares)) + 34
    img = [[(24, 28, 33)] * W for _ in range(H)]
    def px(x, y, c, a=1.0):
        if 0 <= x < W and 0 <= y < H:
            o = img[y][x]; img[y][x] = tuple(int(o[i] * (1 - a) + c[i] * a) for i in range(3))
    def vline(x, y0, y1, c, a=1.0, wd=1):
        for xx in range(x, x + wd):
            for y in range(y0, y1): px(xx, y, c, a)
    y = 20
    for name, col, h in rows:
        for x in range(X0, W - 10): px(x, y + h - 1, (60, 66, 74))
        for i, v in enumerate(O[name]):
            x = X0 + int(i / fr * PPS); bh = int(min(1, v / 0.85) * (h - 4))
            if bh > 0: vline(x, y + h - 1 - bh, y + h - 1, col)
        y += h + 8
    bottom = y
    t = best_phase / fr; k = 0
    while t < dur:
        vline(X0 + int(t * PPS), 20, bottom - 8, (80, 230, 230), 0.55 if k % 4 == 0 else 0.22, 2 if k % 4 == 0 else 1); t += 60 / best_bpm; k += 1
    def strip(y0, bpm, phase, col, strong):
        for x in range(X0, W - 10): px(x, y0 + 11, (50, 56, 64))
        t = phase / fr; k = 0
        while t < dur:
            vline(X0 + int(t * PPS), y0 + (2 if k % 4 == 0 else 8), y0 + 22, strong if k % 4 == 0 else col, 1.0, 2 if k % 4 == 0 else 1); t += 60 / bpm; k += 1
    strip(bottom, best_bpm, best_phase, (80, 230, 230), (150, 255, 255)); bottom += 32
    palette = [((255, 90, 90), (255, 170, 170)), ((255, 210, 80), (255, 235, 150)), ((190, 130, 255), (220, 190, 255))]
    for i, (bpm, phase) in enumerate(compares):
        strip(bottom, bpm, phase, *palette[i % 3]); bottom += 32
    for s in range(0, int(dur) + 1):
        vline(X0 + int(s * PPS), bottom, bottom + (14 if s % 5 == 0 else 7), (170, 176, 184))
    def text(x, y0, s, c, sc=2):
        for ch in s:
            g = FONT[ch]
            for r in range(5):
                for q in range(3):
                    if g[r * 3 + q] == '1':
                        for dx in range(sc):
                            for dy in range(sc): px(x + q * sc + dx, y0 + r * sc + dy, c)
            x += 4 * sc
    for s in range(0, int(dur) + 1, 5): text(X0 + int(s * PPS) + 3, bottom + 12, str(s), (200, 205, 212))
    png(path, W, H, img)

def main():
    ap = argparse.ArgumentParser(description='Measure the tempo of a short clip and draw its rhythm.')
    ap.add_argument('clip'); ap.add_argument('--out'); ap.add_argument('--json'); ap.add_argument('--grid', type=float, help='draw the main beat grid at this tempo instead of the best fit (for example the double or half of it)'); ap.add_argument('--compare', type=float, action='append', default=[], help='draw a beat-grid strip for this tempo too (repeatable, up to 3)')
    a = ap.parse_args()
    wav, tmp = decode(a.clip)
    try:
        fs, x = read_wav(wav)
    finally:
        if tmp: shutil.rmtree(tmp, ignore_errors=True)
    dur = len(x) / fs; fr = fs / HOP
    print(f'{os.path.basename(a.clip)}: {dur:.2f} s at {fs} Hz'); O = bands(x, fs); comb = O['all']
    coarse = sorted(((b / 2, grid_score(comb, fr, b / 2)[0]) for b in range(90, 500)), key=lambda r: r[0])
    peaks = sorted((r for i, r in enumerate(coarse) if 2 <= i < len(coarse) - 2 and r[1] == max(c[1] for c in coarse[i - 2:i + 3])), key=lambda r: -r[1])[:8]
    print('\nBest beat-grid fits (BPM, score; higher is better):')
    for b, s in peaks[:6]: print(f'  {b:6.1f}   {s:5.2f}')
    top = peaks[0][0]
    fine = sorted(((top + d / 10, grid_score(comb, fr, top + d / 10)) for d in range(-30, 31, 2)), key=lambda r: -r[1][0])
    best_bpm, (best_s, best_ph) = fine[0]
    print(f'\nRefined around {top:.1f}: {best_bpm:.1f} BPM (score {best_s:.2f}), first beat at {best_ph / fr:.3f} s')
    print('  half and double (timing alone cannot tell them apart):')
    for lbl, b in (('half', best_bpm / 2), ('double', best_bpm * 2)):
        if 45 <= b <= 250: print(f'    {lbl:6} {b:6.1f} BPM  score {grid_score(comb, fr, b)[0]:.2f}')
    h = len(comb) // 2
    for nm, (lo, hi) in (('first half', (0, h)), ('second half', (h, len(comb)))):
        r = max(((top + d / 10, grid_score(comb, fr, top + d / 10, lo, hi)[0]) for d in range(-30, 31, 5)), key=lambda t: t[1])
        print(f'  {nm}: best {r[0]:.1f} BPM (score {r[1]:.2f})')
    comp = []
    for c in a.compare[:3]:
        s, ph = grid_score(comb, fr, c); comp.append((c, ph)); print(f'  --compare {c:g} BPM: score {s:.2f}')
    for nm in ('low', 'mid', 'high'):
        b, s = max(((b / 2, grid_score(O[nm], fr, b / 2)[0]) for b in range(90, 500)), key=lambda t: t[1]); print(f'  {nm:4} band alone: {b:.1f} BPM (score {s:.2f})')
    shown, shown_ph = (a.grid, grid_score(comb, fr, a.grid)[1]) if a.grid else (best_bpm, best_ph)
    out = a.out or os.path.splitext(a.clip)[0] + '-rhythm.png'
    draw(out, O, fr, dur, shown, shown_ph, comp); print(f'\nWrote {out}')
    print('Teal = best grid (thick = every 4th beat, bar 1 unknown). Other strips = --compare tempos. If a strip slides away from the teal one, that tempo drifts.')
    if a.json: json.dump({'duration': dur, 'best_bpm': best_bpm, 'score': best_s, 'first_beat_s': best_ph / fr, 'peaks': peaks}, open(a.json, 'w'), indent=1)

if __name__ == '__main__':
    main()
