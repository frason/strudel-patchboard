// One small drawing per family of sound, for the sound picker and the sound button on a module.
// Plain strings (48 x 48, drawn with a stroke in the current text colour) so they are cheap to repeat and easy to restyle.
const G = {
  // instruments
  Synth: '<path d="M4 24C9 8 15 8 20 24S31 40 36 24 43 14 44 20"/>',
  Keys: '<rect x="6" y="12" width="36" height="24" rx="3"/><path d="M15 12v24M24 12v24M33 12v24"/><path d="M12 12h6v14h-6zM21 12h6v14h-6zM30 12h6v14h-6z" fill="currentColor"/>',
  Mallets: '<rect x="6" y="20" width="7" height="22" rx="2"/><rect x="15" y="14" width="7" height="28" rx="2"/><rect x="24" y="10" width="7" height="32" rx="2"/><rect x="33" y="16" width="7" height="26" rx="2"/>',
  Organ: '<rect x="6" y="20" width="6" height="22" rx="1"/><rect x="14" y="13" width="6" height="29" rx="1"/><rect x="22" y="7" width="6" height="35" rx="1"/><rect x="30" y="13" width="6" height="29" rx="1"/><rect x="38" y="20" width="4" height="22" rx="1"/>',
  Guitar: '<circle cx="19" cy="31" r="10"/><circle cx="26" cy="23" r="6"/><circle cx="19" cy="31" r="3"/><path d="M30 19L41 8M39 5l5 5"/>',
  Bass: '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3" fill="currentColor"/>',
  Strings: '<path d="M24 15c-8 0-10 6-6 10-4 4-2 10 6 10s10-6 6-10c4-4 2-10-6-10z"/><path d="M24 15V5M7 41L40 9M21 26v4M27 26v4"/>',
  Voice: '<rect x="18" y="5" width="12" height="22" rx="6"/><path d="M11 23c0 9 5 14 13 14s13-5 13-14M24 37v6M17 43h14"/>',
  Brass: '<path d="M5 20h22l15-9v26L27 28H5z"/><path d="M5 20v8"/>',
  Winds: '<g transform="rotate(-35 24 24)"><rect x="1" y="20" width="46" height="8" rx="4"/><circle cx="13" cy="24" r="1.5" fill="currentColor"/><circle cx="20" cy="24" r="1.5" fill="currentColor"/><circle cx="27" cy="24" r="1.5" fill="currentColor"/><circle cx="34" cy="24" r="1.5" fill="currentColor"/></g>',
  Pads: '<path d="M4 17c6-8 10 8 16 0s10 8 16 0 6-4 8-2" opacity=".45"/><path d="M4 26c6-8 10 8 16 0s10 8 16 0 6-4 8-2"/><path d="M4 35c6-8 10 8 16 0s10 8 16 0 6-4 8-2" opacity=".45"/>',
  Other: '<path d="M24 5l5 13 13 5-13 5-5 13-5-13-13-5 13-5z"/>',
  // drums and recorded samples
  Drums: '<ellipse cx="24" cy="19" rx="16" ry="6"/><path d="M8 19v15c0 3 7 6 16 6s16-3 16-6V19"/><path d="M13 6l8 9M35 6l-8 9"/>',
  Cymbals: '<ellipse cx="24" cy="15" rx="18" ry="4"/><ellipse cx="24" cy="22" rx="18" ry="4"/><path d="M24 26v16M16 43h16"/>',
  Percussion: '<ellipse cx="24" cy="11" rx="12" ry="4"/><path d="M12 11c0 10 4 18 5 29h14c1-11 5-19 5-29"/><path d="M15 22h18"/>',
  Loops: '<path d="M38 17a16 16 0 0 0-28 2M10 31a16 16 0 0 0 28-2"/><path d="M38 6v11H27M10 42V31h11"/>',
  Pitched: '<path d="M18 36V11l20-4v25"/><circle cx="13" cy="36" r="5" fill="currentColor"/><circle cx="33" cy="32" r="5" fill="currentColor"/>',
  // single sounds that have a picture of their own
  // two solid hands pointing up and to the right, the front one cut out of the back one by a mask so they stay readable when small, and three sparks
  Clap: '<defs><mask id="clapmask"><rect width="48" height="48" fill="#fff"/><g transform="translate(22 45) rotate(38) scale(.98)"><g fill="#000" stroke="#000"><rect x="-6" y="-13" width="12" height="15" rx="5" stroke-width="3.4"/><path d="M-4.8-11V-21M-1.6-11V-24.5M1.6-11V-23.5M4.8-11V-19.5" stroke-width="6.4"/><path d="M-5.5-2L-9.5-8" stroke-width="6.4"/></g></g></mask></defs><g mask="url(#clapmask)"><g transform="translate(9 44) rotate(38) scale(.98)"><g fill="currentColor" stroke="currentColor"><rect x="-6" y="-13" width="12" height="15" rx="5" stroke-width="0"/><path d="M-4.8-11V-21M-1.6-11V-24.5M1.6-11V-23.5M4.8-11V-19.5" stroke-width="3.2"/><path d="M-5.5-2L-9.5-8" stroke-width="3.2"/></g></g></g><g transform="translate(22 45) rotate(38) scale(.98)"><g fill="currentColor" stroke="currentColor"><rect x="-6" y="-13" width="12" height="15" rx="5" stroke-width="0"/><path d="M-4.8-11V-21M-1.6-11V-24.5M1.6-11V-23.5M4.8-11V-19.5" stroke-width="3.2"/><path d="M-5.5-2L-9.5-8" stroke-width="3.2"/></g></g><path d="M32.6 7.0L30.9 2.8M37.0 6.8L38.4 2.5M40.5 9.6L44.3 7.2" stroke-width="2.6"/>',
  Maracas: '<circle cx="13" cy="13" r="7"/><path d="M18 18L37 41"/><circle cx="38" cy="42" r="1.8" fill="currentColor"/><circle cx="35" cy="13" r="7"/><path d="M30 18L11 41"/><circle cx="10" cy="42" r="1.8" fill="currentColor"/><circle cx="11" cy="11" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="33" cy="11" r="1" fill="currentColor"/><circle cx="37" cy="15" r="1" fill="currentColor"/>',
  Kick: '<circle cx="22" cy="26" r="16"/><circle cx="22" cy="26" r="10" stroke-dasharray="2 3"/><circle cx="22" cy="26" r="2.5" fill="currentColor"/><path d="M36 12l-8 8M36 12a3 3 0 1 1 4-4"/>',
  // hi-hats: closed, the two cymbals nearly touch; open, they are clearly apart
  HatClosed: '<ellipse cx="24" cy="19.5" rx="18" ry="4"/><ellipse cx="24" cy="23" rx="18" ry="4"/><path d="M24 27v15M16 43h16"/>',
  HatOpen: '<ellipse cx="24" cy="9" rx="18" ry="4" transform="rotate(-6 24 9)"/><ellipse cx="24" cy="24" rx="18" ry="4"/><path d="M24 28v14M16 43h16"/>',
  Cymbal: '<ellipse cx="24" cy="15" rx="20" ry="4.5"/><ellipse cx="24" cy="13.5" rx="4" ry="1.8"/><path d="M24 20v22M16 43h16"/>',
  Cowbell: '<path d="M15 16h18l6 24H9z"/><path d="M20 16v-5h8v5"/><path d="M17 26h14"/>',
  Tambourine: '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="11"/><circle cx="24" cy="7" r="2.2" fill="currentColor"/><circle cx="41" cy="24" r="2.2" fill="currentColor"/><circle cx="24" cy="41" r="2.2" fill="currentColor"/><circle cx="7" cy="24" r="2.2" fill="currentColor"/>',
};
// Which drawing a sound gets: a few well-known single sounds have their own, everything else uses the drawing of its family.
// "cp" and "clap" are hands, "sh" and "ma" are maracas, and so on (trailing numbers and :variants are ignored).
const SOUND_RULES = [
  [/(^cp(\d|$)|clap)/, 'Clap'],
  [/(^(sh|ma|cabasa)(\d|$)|shak|marac)/, 'Maracas'],
  [/^(bd(\d|$)|kick|bassdrum)/, 'Kick'],
  [/^((cr|rd|cy)(\d|$)|crash|ride|cymbal|splash|china)/, 'Cymbal'],
  [/^(oh(\d|$)|openhat|open)/, 'HatOpen'],
  [/^(hh(\d|$)|closedhat|closed|hat(\d|$))/, 'HatClosed'],
  [/(^cb(\d|$)|cowbell)/, 'Cowbell'],
  [/(^tb(\d|$)|tamb)/, 'Tambourine'],
];
export const soundGlyph = (id, cat) => {
  const name = String(id || '').split(':')[0].toLowerCase();
  return SOUND_RULES.find(([re]) => re.test(name))?.[1] || cat;
};
export const soundIconSvg = (cat, size = 40, extra = '') =>
  `<svg viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${G[cat] || G.Other}</svg>`;
export const hasSoundIcon = (cat) => cat in G;
