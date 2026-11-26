# Ingesting a Codex answer (checklist for Claude)

Do this when `npm run handoff:list` shows a handoff addressed to you with `status: answered`, and before building anything the answer affects.
Never skip a finding because it is inconvenient: every numbered finding gets a recorded decision.

1. **Fetch.** If the answer is on a Codex branch: `npm run handoff:fetch -- codex/<branch>` (add `--apply` to copy the Response into the file on `main`). If the owner pasted it, it is already under `## Response`. Run `npm run handoff:check`.
2. **Read all of it**, including "what I did not check". Re-run any command the Response relies on; mark each finding **confirmed**, **not reproduced** or **could not test**. A finding you could not reproduce is not accepted yet.
3. **Write the Disposition** under `## Disposition`, one line per numbered finding and per answered question:
   `F1: accepted | rejected | deferred - reason - where it went (ROADMAP section / DECISIONS entry / task)`.
   - Rejected needs a reason that a third person could check.
   - Anything that changes a rule in `AGENTS.md`, the guard, security, costs, or the scope the owner approved is **not mine to accept**: write `needs the owner` and ask them.
4. **Update the plan.** Changes to order, design or open questions go into `docs/ROADMAP.md` (edit the section; add a dated line under "Changes from review"). Decisions that should survive go into `docs/DECISIONS.md` (one entry each: context, decision, consequences, source handoff id).
5. **Make it buildable.** For each accepted finding that needs work, say in the Disposition which files change and which test will prove it. Importer/compiler changes get a real-song replay test.
6. **Tell the owner**: a short summary (accepted / rejected / deferred counts, the three things that matter most, anything waiting on them). Do not start large work the owner has not approved.
7. **Set `status: ingested`**, run `npm run handoff:index`, and run `npm run handoff:check`. When the accepted work is done, set `status: closed` and note the commit.

If the answer contradicts something already decided in `docs/DECISIONS.md`, do not silently overwrite the decision: record both and ask the owner.
