# Handoff system: Claude Code <-> Codex

The owner works with two agents. **Claude Code** builds in the owner's live session on `main`. **Codex** reviews, challenges and prototypes on its own branch
(`codex/*`, in a separate git worktree such as `~/.codex/worktrees/<name>/Strudel_Board`). They cannot see each other's conversations, and Codex's worktree does not
see files that are only on `main` and uncommitted. This folder is how work crosses over without anything being lost or guessed.

## The unit: one handoff file

`docs/handoff/NNNN-short-topic.md` (four digits, never reused). One file holds the whole exchange, in three sections, so nothing drifts apart:

```
---
id: 0001
title: Roadmap review
from: claude          # claude | codex | owner
to: codex             # claude | codex
status: open          # open | answered | ingested | closed | declined
created: 2026-11-25
refs: docs/ROADMAP.md # files the receiver must read (comma separated, repo-relative)
---
## Request          (sender writes)
## Response         (receiver writes)
## Disposition      (sender writes after reading the Response)
```

### Status lifecycle

| status | meaning | who sets it |
|---|---|---|
| `open` | written and waiting for the receiver | sender |
| `answered` | the Response section is filled in | receiver |
| `ingested` | the sender read the Response and recorded a Disposition (what was accepted, rejected, deferred, and why) | sender |
| `closed` | everything accepted is done (or recorded in `docs/ROADMAP.md`) | sender |
| `declined` | the receiver says it will not answer, with the reason in the Response | receiver |

## How each side works

**Sending** (either agent): `npm run handoff:new -- "Title" --to codex --refs docs/ROADMAP.md`, then fill in the Request using `TEMPLATE-request.md` as the guide:
what you want, what you already know (observed / inferred / guessed), the files to read, what is out of scope, and what a good answer looks like. Commit the file on `main`
**only when the owner says to commit**. Until then tell the owner the file path; they can hand it over by path, paste or commit.

**Receiving**: read the Request and every file in `refs`. Write the answer under `## Response` in the same shape as `TEMPLATE-response.md` (verdict first, then
numbered findings, each tagged observed / inferred / guessed, each with a file reference and a recommendation, then risks and what you did not check). Set `status: answered`.
Commit only that file on your own branch. Do not touch `src/` unless the Request asks for a prototype; a prototype stays on its branch and is described in the Response.

**Reading an answer** (the sender): follow `INGEST.md`. In short: fetch it, record a Disposition for **every** numbered finding, copy what changes the plan into `docs/ROADMAP.md`,
record decisions in `docs/DECISIONS.md`, then set `status: ingested`.

## Where answers come from

1. **Codex's branch** (normal case): `npm run handoff:fetch -- codex/<branch>` lists handoff files on that branch that differ from `main`
   (it reads them with `git show`, so no checkout is needed). `--apply` copies the Response section into the matching file on `main` and sets `status: answered`.
2. **Pasted by the owner**: paste the text under `## Response`, add a line `Source: pasted by the owner on <date>`, set `status: answered`.
3. **A file the owner drops in**: treat it like a paste.

## Rules for every handoff

- The owner decides. Neither agent merges, pushes, deploys or changes scope on the strength of a handoff alone; recommendations that change the constraints in `AGENTS.md` go to the owner first.
- Everything is repo-relative and plain Markdown. No secrets, no API keys, no private data in a handoff file (they are committed).
- Be specific: file paths with line numbers where it helps, commands that were run and what they printed.
- Never rewrite another side's section. Add a dated note under your own section instead.
- A Request that cannot be answered without running code says which command to run; the Response says what was run and what was observed.

## Tools

```bash
npm run handoff:new -- "Title" --to codex --refs docs/ROADMAP.md,src/compile.js   # create the next numbered file from the template
npm run handoff:list                                                              # table of every handoff and its status
npm run handoff:check                                                             # validate front matter, sections, refs and status rules
npm run handoff:context                                                           # repo facts to cite or paste (also written to CONTEXT.md, not committed)
npm run handoff:fetch -- codex/youtube-strudel [--apply]                          # find and bring in answers from a Codex branch
npm run handoff:index                                                             # rewrite INDEX.md from the files
```

Open handoffs: see `INDEX.md`. Decisions made from them: `../DECISIONS.md`. The plan they feed: `../ROADMAP.md`.
