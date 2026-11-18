// Web MIDI input: which keyboards are plugged in, and their notes. Chrome and Edge have it; Safari (also on iPhone) does not.
export async function openMidi() {
  if (!navigator.requestMIDIAccess) return { error: 'This browser has no MIDI input (Chrome and Edge do; Safari, also on iPhone, does not). The computer keyboard works instead.' };
  let access;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); }
  catch (e) { return { error: 'The browser did not allow MIDI access (' + (e && e.message ? e.message : 'refused') + '). Allow it in the address bar, or use the computer keyboard.' }; }
  const inputs = () => [...access.inputs.values()].filter((i) => i.state !== 'disconnected').map((i) => ({ id: i.id, name: i.name || 'MIDI input' }));
  return {
    inputs,
    onChange(cb) { access.onstatechange = cb; },
    // onNote(kind 'on' | 'off', note, velocity 0 to 1, timestamp in performance.now() time). Returns a function that stops listening.
    listen(id, onNote) {
      const inp = access.inputs.get(id); if (!inp) return () => {};
      const fn = (e) => {
        const [st, n, v] = e.data || [], kind = st & 0xf0, ts = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now();
        if (kind === 0x90 && v > 0) onNote('on', n, v / 127, ts);
        else if (kind === 0x80 || (kind === 0x90 && v === 0)) onNote('off', n, 0, ts);
      };
      inp.addEventListener('midimessage', fn);
      return () => inp.removeEventListener('midimessage', fn);
    },
  };
}
