// Reading a Standard MIDI File (.mid) into takes: one per track and channel, notes in beats, ready for the Take module.
//   result = { bpm, beatsPerBar, tracks: [{ name, channel, drums, events: [{ t, d, n, v }], trimmed }], warnings: [] }
// or { error } when the file is not one this can read. Plain functions on bytes, so it is tested without a browser.
// Beats do not depend on the tempo map (a tick is always 1/ppq of a beat), so only the first tempo is kept, as the take's BPM.
const MAX_EVENTS = 2000, MAX_BEATS = 4096, MAX_TRACKS = 64;

export function parseMidi(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 14 || u[0] !== 0x4d || u[1] !== 0x54 || u[2] !== 0x68 || u[3] !== 0x64) return { error: 'This is not a MIDI file (it should start with "MThd").' };
  const u16 = (p) => (u[p] << 8) | u[p + 1], u32 = (p) => ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0;
  const hl = u32(4), format = u16(8), ntrk = u16(10), div = u16(12);
  if (hl < 6) return { error: 'The MIDI file header is damaged.' };
  if (div & 0x8000) return { error: 'This MIDI file counts time in frames (SMPTE) rather than beats, which Patchboard cannot read.' };
  if (format > 2) return { error: `This MIDI file is format ${format}, which Patchboard does not know.` };
  const ppq = div || 480, warnings = [];
  let bpm = 0, beatsPerBar = 0, pos = 8 + hl, trkCount = 0;
  const out = [];
  while (pos + 8 <= u.length && trkCount < Math.min(ntrk, MAX_TRACKS)) {
    const id = String.fromCharCode(u[pos], u[pos + 1], u[pos + 2], u[pos + 3]), len = u32(pos + 4), start = pos + 8, end = Math.min(u.length, start + len);
    pos = start + len;
    if (id !== 'MTrk') continue;
    trkCount++;
    let p = start, tick = 0, status = 0, name = '', cut = false;
    const open = new Map(), byCh = new Map();   // open: channel*128+note -> { t, v }
    const ch = (c) => byCh.get(c) || byCh.set(c, []).get(c);
    const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { if (p >= end) { cut = true; return v; } const b = u[p++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } return v; };
    const close = (c, n, t) => { const k = c * 128 + n, o = open.get(k); if (!o) return; open.delete(k); ch(c).push({ t: o.t, d: Math.max(0.05, t - o.t), n, v: o.v }); };
    while (p < end && !cut) {
      tick += vlq();
      if (p >= end) break;
      let s = u[p];
      if (s & 0x80) { p++; if (s < 0xf0) status = s; } else s = status;   // a data byte here means running status
      const beat = tick / ppq;
      if (s === 0xff) {
        const type = u[p++], l = vlq(), body = p; p += l;
        if (type === 0x2f) break;
        if (type === 0x51 && l === 3 && !bpm) bpm = Math.round((60000000 / ((u[body] << 16) | (u[body + 1] << 8) | u[body + 2])) * 100) / 100;
        else if (type === 0x58 && l >= 2 && !beatsPerBar) beatsPerBar = Math.round(u[body] * (4 / 2 ** u[body + 1])) || 4;
        else if (type === 0x03 && !name) name = String.fromCharCode(...u.slice(body, body + l).filter((x) => x >= 32 && x < 127)).trim();
      } else if (s === 0xf0 || s === 0xf7) { p += vlq(); }
      else if (s >= 0xf1) { p += s === 0xf2 ? 2 : s === 0xf3 ? 1 : 0; }
      else {
        const c = s & 0x0f, kind = s & 0xf0, twoBytes = kind !== 0xc0 && kind !== 0xd0, a = u[p++], b = twoBytes ? u[p++] : 0;
        if (kind === 0x90 && b > 0) { close(c, a, beat); if (beat <= MAX_BEATS) open.set(c * 128 + a, { t: beat, v: Math.max(0.1, Math.min(1, b / 127)) }); }
        else if (kind === 0x80 || kind === 0x90) close(c, a, beat);
      }
    }
    const last = tick / ppq;
    for (const k of [...open.keys()]) close(k >> 7, k & 127, last);   // a note never released ends with the track
    for (const [c, evs] of [...byCh].sort((x, y) => x[0] - y[0])) {
      if (!evs.length) continue;
      evs.sort((x, y) => x.t - y.t || x.n - y.n);
      const kept = evs.filter((e) => e.t <= MAX_BEATS).map((e) => ({ t: Math.round(e.t * 1000) / 1000, d: Math.round(Math.min(e.d, MAX_BEATS - e.t) * 1000) / 1000, n: e.n, v: Math.round(e.v * 100) / 100 }));
      out.push({ name, channel: c + 1, drums: c === 9, events: kept.slice(0, MAX_EVENTS), trimmed: Math.max(0, kept.length - MAX_EVENTS), total: kept.length });
    }
  }
  if (ntrk > MAX_TRACKS) warnings.push(`The file has ${ntrk} tracks; only the first ${MAX_TRACKS} were read.`);
  if (!out.length) return { error: 'There are no notes in this MIDI file.' };
  // name each take: the track's name, else "Channel n"; two takes from one track share its name with the channel added
  const counts = new Map(); out.forEach((t) => counts.set(t.name, (counts.get(t.name) || 0) + 1));
  for (const t of out) {
    const base = t.drums ? (t.name ? `${t.name} (drums)` : 'Drums') : t.name || `Channel ${t.channel}`;
    t.name = t.name && counts.get(t.name) > 1 && !t.drums ? `${t.name} (ch ${t.channel})` : base;
    t.name = t.name.slice(0, 40);
    const ns = t.events.map((e) => e.n); t.low = Math.min(...ns); t.high = Math.max(...ns);
    t.beats = Math.max(...t.events.map((e) => e.t + e.d));
  }
  return { bpm: Math.min(300, Math.max(20, bpm || 120)), beatsPerBar: Math.min(12, Math.max(1, beatsPerBar || 4)), ppq, format, tracks: out, warnings };
}

// 4 steps a beat (plain 16ths) when the notes sit on it, otherwise 12 (16ths and triplets)
export function pickGrid(events) {
  const off = (g) => events.reduce((m, e) => Math.max(m, Math.abs(e.t * g - Math.round(e.t * g)) / g), 0);
  return off(4) < 0.02 ? 4 : 12;
}

export const isMidiFile = (name, bytes) => /\.(mid|midi|kar)$/i.test(name || '') || (bytes && bytes.length > 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64);
