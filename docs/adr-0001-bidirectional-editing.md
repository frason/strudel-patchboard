# ADR 0001: Bidirectional editing of Strudel code and the module board

Status: proposed (not implemented). Date: 2026-11-16. Baseline commit: b141faf.

## Context (verified in the code)

- The graph (`src/graph.js`, `src/store.js`) is the source of truth. `compile.js` turns it into code plus `segments` (character ranges tagged with
  module, role, knob key, step, track). `codepanel.js` shows the code; `setCompiled` replaces the whole document on every change.
- The panel is editable only inside mapped numbers (a transaction filter) and in "choice" words that open the module's own picker. These go back
  through `hooks.setParam`. Everything else is locked.
- `importer.js` (Acorn) reads a deliberate subset of Strudel and builds a NEW graph (new node ids, positions by statement) with a report of what
  it skipped. It is a one-time converter, not a live reconciler.
- `engine.js` evaluates the compiled string; `hap.context.locations` are offsets into that string and drive event highlighting through `segments`.
- Undo/redo and autosave live in `store.js` and cover the graph only. `io.js` exports code plus an embedded base64 graph and, on import, compares
  the file's code with `compile(graph).code`.

The gap: general text editing with reconciliation of the graph, with no loss of unsupported code. Today code that cannot be a module is simply not
representable; it must become preserved text.

## Decision

1. One document, one history. A `PatchDocument` holds `source` (exact text), `graph` (the reconciled supported part, including layout, groups,
   collapsed state), `bindings` (stable node/param id <-> source span) and `opaque` regions (source not represented by modules, kept verbatim).
   Graph edits and text edits are both transactions on this document; undo/redo, autosave and snapshots store the document, not the graph alone.
2. Source is authoritative for what the user typed; the graph is the editable view of the supported part. Neither silently overwrites the other.
3. Module edit -> minimal source patch. A knob change replaces only the number's span (CodeMirror change, whitespace/comments/selection kept).
   A structural change (insert a filter) edits the smallest safe enclosing expression; if no safe edit exists it is refused with an explanation.
4. Code edit -> debounced Acorn parse with offsets -> semantic extraction -> reconcile against existing nodes -> minimal graph diff.
   Identity is matched in order: persisted binding ids mapped through the edit, structural signature plus neighbours, then user-visible role.
   Character offset alone never proves identity. Unmatched supported constructs create nodes; vanished ones remove only their node and wires.
   A syntax error keeps the last valid board and the user's text, shows a diagnostic, and nothing invalid is evaluated.
5. Unsupported code is kept as opaque source with a visible "code-only" marker. Visual edits of the supported parts never delete it. Where an opaque
   region wraps or depends on a supported expression, the conflicting visual transformation is disabled, not guessed.
6. Execution policy (needs a product decision, see below): parse validity, visual representability and permission to execute are three
   different questions. Recommended public default: only code the compiler can regenerate from the semantic model is evaluated (an allow-listed
   subset, checked by an AST guard). Opaque/custom code is preserved and shown but not executed. An explicit local "power mode" for arbitrary
   Strudel JavaScript is a separate, opt-in feature with its own threat model; an iframe or worker is not assumed to be a sandbox.
7. Source maps: bindings are kept against the exact string passed to `repl.evaluate`. If any preprocessing changes the text, keep both editor
   offsets and evaluated offsets. Between a CodeMirror edit and the next successful parse, map existing spans through the change description.
8. Persistence: a v2 project format `{ v:2, source, graph, bindings, opaque }` with migration from v1 graph-only saves; keep exporting a plain
   playable `.strudel` and keep importing old `.json` and embedded-graph files. Never trust an embedded graph that no longer matches its code.

## Security prerequisites (blockers for the live-editing path)

Free-text editing adds a path from user-authored text toward `repl.evaluate`. Before it ships, the existing path must be closed:
unvalidated parameters are emitted raw into evaluated code (finding S1), a remote soundfont file is `eval`'d (S2) and Hydra code is raw by design (S3).
Details are kept privately until fixed. The compiler output guard in item 6 is the same mechanism that protects the existing graph path.

## Vertical slice (first implementation)

Edit `.gain(0.7)` -> `.gain(0.4)` in the code panel and see the same Sample/Instrument node, same position and wires, knob updated, comments and
formatting untouched; edit the knob and see only that numeric span change. Out of scope for the slice: structural edits, opaque regions,
persistence format, AI. Pure functions first (parse -> extract -> reconcile -> diff -> span patch), tested without DOM or audio.

## Phases

0. Baseline and security triage (done in part: see the private baseline). 1. Security blockers S1-S3 and import limits (S4).
2. Pure document operations and the vertical slice. 3. General typing in the panel with transaction origin markers (no string-equality loop
guards). 4. Structural edits, opaque regions, execution guard. 5. v2 persistence, AI through the same pipeline, README and in-app help.
6. Headers/CSP, dependency actions, launch verification (acceptance matrix in the project brief).

## Alternatives considered

- Regenerate the whole document from the graph on every change (current): simple, but destroys comments, formatting and any custom code.
- Run the importer on every keystroke and replace the board: loses positions, ids, groups and selection; rejected.
- Make the text the only source and derive the board from it: loses layout and visual-only state and makes drag/knob edits depend on the parse.
- Arbitrary JavaScript execution for public users: not a sandbox problem we should solve implicitly; kept as an explicit, separate decision.

## Open decisions (owner: project owner)

1. Public execution policy: allow-listed subset only (recommended), or arbitrary JavaScript behind an isolation design.
2. API key storage default: in-memory (recommended) or persisted with explicit opt-in.
3. Whether imported patches containing a Hydra module are refused or require explicit confirmation.
4. Whether to keep the plain-text key migration (clear old stored keys on upgrade).
