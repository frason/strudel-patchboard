// The curated library: boards that ship inside the app as files in library/ (nothing is fetched). Each file is { v:1, kind:'patchboard-library-entry', id, title, about, by, graph }.
// An entry goes through the same checks as a shared link (shape, expansion count, compile, guard) before it is listed, and opening one is always a copy that replaces the board (undoable).
// Plain functions, so the checks are tested without a page; main.js passes in the files Vite bundled.
import { checkBoard, describeBoard } from './share.js';
import { LIMITS } from './validate.js';

export const LIBRARY_KIND = 'patchboard-library-entry';
export const LIBRARY_MAX_BYTES = 4 * LIMITS.bytes;   // all the files together: they are parsed when the dialog first opens, so growth has a stated limit
const clean = (t, n) => (typeof t === 'string' ? t : '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);   // metadata must be text: anything else is treated as missing, never converted (an object can throw when it is)

// one file's content -> { entry } or { error }. Never throws.
export function parseEntry(raw, file = '') {
  try { return parseEntryUnsafe(raw, file); } catch (e) { return { error: `${file || 'entry'}: could not be read (${String((e && e.message) || e).slice(0, 80)})` }; }
}
function parseEntryUnsafe(raw, file) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.kind !== LIBRARY_KIND) return { error: `${file || 'entry'}: not a library entry` };
  const id = clean(raw.id, 60);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: `${file || 'entry'}: the id must be lowercase letters, digits and dashes` };
  const r = checkBoard(raw.graph);   // checkBoard holds the same size limit a share link has
  if (r.error) return { error: `${id}: ${r.error}` };
  return { entry: { id, title: clean(raw.title, 80) || id, about: clean(raw.about, 400), by: clean(raw.by, 60), graph: r.graph, code: r.code, issues: r.issues, facts: describeBoard(r.graph, r.code) } };
}

// { './path.json': content } (what import.meta.glob gives) -> { entries, errors }, sorted by title; a duplicate id keeps the first
export function loadLibrary(files) {
  const entries = [], errors = [], seen = new Set();
  let bytes = 0;
  for (const [file, content] of Object.entries(files || {})) {
    const r = parseEntry(content && content.default !== undefined ? content.default : content, file.split('/').pop());
    if (r.error) { errors.push(r.error); continue; }
    bytes += JSON.stringify(r.entry.graph).length; if (bytes > LIBRARY_MAX_BYTES) { errors.push(`${r.entry.id}: the library is over its size limit (${Math.round(LIBRARY_MAX_BYTES / 1e6)} MB), so this and later files are left out`); break; }
    if (seen.has(r.entry.id)) { errors.push(`${r.entry.id}: listed twice, the second is ignored`); continue; }
    seen.add(r.entry.id); entries.push(r.entry);
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
  return { entries, errors };
}
