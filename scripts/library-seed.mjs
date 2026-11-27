// Writes the starting library files from boards that already exist (the lesson boards). Run once: node --import ./scripts/stub-loader.mjs scripts/library-seed.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { LESSONS } from '../src/starters.js';
const PICK = { song: 'Drums, bass and a lead layered into one small song.', trance: 'Acid line, ducking and views: a trance-style loop.', chords: 'Chords and arpeggios from one key.', 'whole-song': 'A full arrangement that uses four of the newer modules.' };
mkdirSync(new URL('../library/', import.meta.url), { recursive: true });
for (const [id, about] of Object.entries(PICK)) {
  const l = LESSONS.find((x) => x.id === id); if (!l) throw new Error('no lesson ' + id);
  const graph = l.graph();
  writeFileSync(new URL(`../library/${id}.json`, import.meta.url), JSON.stringify({ v: 1, kind: 'patchboard-library-entry', id, title: l.title.replace(/^\d+\s*·\s*/, ''), about, by: 'Patchboard lessons', graph: { v: graph.v, nodes: graph.nodes, wires: graph.wires, groups: graph.groups || [] } }, null, 1) + '\n');
}
console.log('written');
