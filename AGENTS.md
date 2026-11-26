# Instructions for Codex (and any coding agent) working in this repo

This is **Strudel Patchboard**: a browser app (Vite, plain JavaScript) that is a visual patcher for live-coded music. You connect modules with cables and the app
writes Strudel code, plays it with Strudel's engine, and reads Strudel code back into modules. Read `docs/ROADMAP.md` section 1 for the architecture in one page.

## First, the handoff system

Work is passed between **Claude Code** (builds in the owner's session on `main`) and **Codex** (reviews, challenges, prototypes on a `codex/*` branch) through files in
`docs/handoff/`. **Read `docs/handoff/README.md` before doing anything else**, then open `docs/handoff/INDEX.md` to see which handoffs are open for you.

Short version:
- A handoff is one file, `docs/handoff/NNNN-topic.md`, with three sections: **Request** (written by the sender), **Response** (written by the receiver), **Disposition** (written by the sender after reading the Response).
- If a handoff is addressed `to: codex` and `status: open`, write your answer under `## Response`, set `status: answered` in the front matter, and commit **only that file** on your branch. Use `docs/handoff/TEMPLATE-response.md` for the shape of the answer.
- Do not edit `src/` for a review handoff unless the request says to prototype. A prototype lives on its own branch and is described in the Response; it is never merged by you.
- `npm run handoff:list` shows the state of every handoff, `npm run handoff:check` validates the files, `npm run handoff:context` prints the current repo facts to cite.

## Rules that always apply

1. **Never commit, push, merge or deploy unless the owner asks.** Your own branch is yours; `main` is not. Deploys are manual (`npm run build`, then `npx wrangler pages deploy ...`) and only the owner does them.
2. **The guard stays.** `src/guard.js` is an allow-list parser that every piece of code must pass before Strudel evaluates it (the app keeps an AI key in localStorage). Extend it narrowly, with tests, and never bypass it. A sandboxed "Script mode" for arbitrary JavaScript was considered and **declined by the owner**.
3. **No secrets leave the browser** (AI key, settings). **No downloads without consent** (sample packs ask first).
4. **Import fidelity.** Anything that changes `src/importer.js` or `src/compile.js` needs a real-song replay test in `scripts/verify.mjs` showing the same events as the original code in real Strudel.
5. **Say what you did not verify.** Mark claims as observed (you ran it), inferred (you read the code) or guessed. The owner reads these answers to decide.
6. No framework, no new build-time dependency without a stated reason.

## Commands

```bash
npm run dev            # Vite on http://localhost:5174
npm test               # verify + reconcile + guard suites (all must pass)
npm run handoff:list   # state of every handoff
npm run handoff:check  # validate the handoff files
```
Tests run in Node with `scripts/stub-loader.mjs`; browser-only behaviour is checked by driving the dev server.
