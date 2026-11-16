# ADR 0001: Bidirectional editing of Strudel code and the module board

Status: stages 1 and 2 implemented (engine, and free typing in the code panel with the person's text kept); the rest proposed. Date: 2026-11-16. Baseline commit: b141faf.

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


## Progress: stage 1, the pure engine (2026-11-16)

`src/reconcile.js` (`applyCodeEdit(graph, editedCode)`) turns edited text into the smallest change to the board, with no DOM, store or audio:

1. Exact path (`numberEdits`): when the edited text is the compiled text with only knob numbers changed, each number goes straight to the module and knob
   that wrote it (compile's segments), through the same clamping rules as typing in the panel (`src/codenums.js`, shared with the panel).
2. Structural path (`applyEdit`): the code the board writes (before) and the edited code (after) are both read by the importer, the two readings are matched
   by chain position and kind (never by line or offset), and only the differences are applied to the real board. A module the edit did not touch is never
   rewritten, so its settings, position, size, collapsed and mute state survive, even where the importer reads it back in another shape.
3. Reported, not dropped: code the importer cannot read is returned in `report.skipped`; an edit that touches a module the importer reads back as several
   (drum machine, a multi-layer Sample) comes back in `changes.unapplied` with a reason, and that module is left as it is.
4. Modules the code does not describe (muted, or with no cable to the output) are never removed by an edit.

Tests (`npm run test:reconcile`): unchanged code leaves every lesson's board identical (31/31); changing one number in every lesson moves the right knob and
the board writes back exactly the edited code (25/25); delete, add, reorder, rename, muted and unconnected modules, groups, invalid code, unreadable lines.

Open design question for stage 2 (the editor): what the text shows after an edit is applied. Regenerating the document from the board would drop the
person's comments and layout; keeping their text means the segment offsets (hover, playing marks, click-to-edit numbers) no longer line up until the importer
records source spans for each reading. See the question to the project owner.


## Progress: stage 2, free typing with the person's text kept (2026-11-16)

Decision by the project owner: when the board and the typed text disagree, the person's text wins (nothing is rewritten without being asked).

- Text -> board (`codeTyped` in `src/main.js`): 600 ms after typing stops, `applyCodeEdit` runs against `textBase` (the board's code when the text last agreed
  with the board), so a board change made in the meantime is merged, not undone. One coalesced undo step ("edit code").
- Read-back (`checkSync`, `src/textsync.js`): after every apply the board is read back and compared with the text. States: ok, error (invalid JavaScript; the
  board keeps the last valid state), partial (parts kept in the text that do not play, each listed with its reason) and differs (two buttons: make the text match
  the board, or the board match the text).
- Board -> text (`patchText`): a knob move, undo, redo or any board edit is carried into the person's text as one small edit found by the text around it
  (whitespace-tolerant, ambiguity refused); if the surrounding text was edited away it falls back to a unique match of the changed text itself, and otherwise
  the "differs" state asks. Multi-line changes are aligned to whole lines.
- Highlights, plain-English notes and click-to-edit are positions in the board's code, so they are switched off while the text differs from it. Restoring them
  for a differing text needs the importer to record source spans (stage 3).
- The text survives a reload while the board is unchanged (`pb.codeText`, keyed by the canonical code); opening a lesson, Import and New start from the board's code.
- Settings -> Code panel -> "numbers only" keeps the previous locked panel.

Known limits: the person's text is not part of saved patches, exports or history snapshots yet (v2 format, stage 5); a module the importer reads back as several
(drum machine, a multi-layer Sample) cannot be changed structurally from the text yet (reported as "differs"/partial, never dropped); the typed text is not
evaluated directly: the audio plays what the board writes, so text that cannot be shown does not play.
