// Recording the output: the browser hands over 16-bit stereo samples in pieces; this joins them into a WAV file. Plain functions, tested without a browser.
export const REC_MAX_SECONDS = 15 * 60;   // 15 minutes of 16-bit stereo is about 170 MB: the recording stops itself there

// chunks: Int16Array pieces of interleaved samples (left, right, left, right...). Returns the bytes of a .wav file.
export function wavBytes(chunks, sampleRate, channels = 2) {
  let total = 0; for (const c of chunks) total += c.length;
  const bytes = new Uint8Array(44 + total * 2), dv = new DataView(bytes.buffer);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + total * 2, true); tag(8, 'WAVE'); tag(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true); tag(36, 'data'); dv.setUint32(40, total * 2, true);
  let at = 44;
  for (const c of chunks) { for (let i = 0; i < c.length; i++, at += 2) dv.setInt16(at, c[i], true); }
  return bytes;
}
export const recordingSeconds = (chunks, sampleRate, channels = 2) => chunks.reduce((n, c) => n + c.length, 0) / channels / sampleRate;
export const recordingName = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `patchboard-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.wav`; };
