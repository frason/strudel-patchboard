# Instructions for Claude Code in this repo

Strudel Patchboard: a browser app (Vite, plain JavaScript) that is a visual patcher for live-coded music (see `docs/ROADMAP.md` section 1 for the architecture).

- **Handoffs with Codex** live in `docs/handoff/` (read `docs/handoff/README.md`). At the start of a session, run `npm run handoff:list`. When a handoff addressed to you is `answered`, follow `docs/handoff/INGEST.md` before building anything it affects.
- Never commit or push unless the owner says so ("commit and push"). The owner deploys manually.
- `npm test` must pass (verify, reconcile, guard). Importer or compiler changes need a real-song replay test in `scripts/verify.mjs`.
- The guard (`src/guard.js`) is a security boundary; extend it narrowly. Script mode was declined by the owner.
- Decisions go in `docs/DECISIONS.md`; the plan is `docs/ROADMAP.md`.
