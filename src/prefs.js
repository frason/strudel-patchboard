// Display preferences, kept per browser. None of these change the patch or the code.
const KEY = 'pb.prefs';
const DEFAULTS = { colourful: false, cables: 'curved', labels: 'hover', minimap: true, safeOutput: true, descriptions: 'folded', animations: true, jackHelp: true, outScope: true };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* defaults */ }
const subs = new Set();
export const getPrefs = () => prefs;
export function setPref(k, v) {
  prefs = { ...prefs, [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  subs.forEach((f) => f(prefs, k));
}
export const onPrefs = (f) => subs.add(f);
