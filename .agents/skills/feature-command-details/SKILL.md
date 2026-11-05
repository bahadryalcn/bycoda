---
name: feature-command-details
description: "Change command inspection and background output: exact command, output deltas/snapshots, truncation, remote loading, Copy, Stop and follow-tail."
---

# Command details

Own inspection of an existing tool call, not a new execution surface. Provider adapters own output interpretation; Host/native own process access. Transcript output is not a fresh filesystem read or proof that a process is alive.

## Source entry points

Code paths below are repository-root relative.

- `src/features/sessions/ui/SubagentSheet.tsx`
- `src/features/sessions/model/commandInspection.ts`
- `src/features/sessions/ui/ToolInspectionPanel.tsx`

## Workflow

1. Trace the selected block by stable ID through ActivityDock, details sheet, inspector and Copy. Inspect provider delta/snapshot contracts before changing accumulation.
2. Use the shared command-inspection selector so exact command, output precedence, errors and truncation agree across consumers.
3. Keep remote full-block loading explicit and revision-bound with local pending/error/retry. Follow-tail must pause while the reader inspects earlier output.
4. Check multi-delta/final output, silent running versus finished-empty, interrupted sessions, truncation and late Copy/Stop outcomes.

## Preserve

- Parse each complete saved JSON section once per source update and reuse its value for eligibility and rendering. Clipboard/wrap feedback must not repeatedly parse retained output; commands, diffs, truncated and invalid JSON keep exact text.
- Retain exact command/output bytes, selection, horizontal reading and legacy/summary/full distinctions; never globally append snapshot updates.
- Transcript subagent rows keep lifecycle, elapsed time and step summary inline before the disclosure control, including runs without steps. Failed-step counts use the danger role without changing the run lifecycle; the detached sheet retains its own state line.
- Stop is gated by capability and call identity; acknowledgement does not prove process termination. Never rerun or kill work to populate an inspector.
- Do not fabricate per-command cwd, exit status or timing from turn metadata. Label session working directory truthfully when that is the available provenance.
- Preserve clipboard fallback, duplicate guards, stale-result cleanup, navigation identity, nonmodal focus and the shared overlay stack.
- Keep provider-owning-machine task-output path/tail guards; UI polling must not gain arbitrary file access.

## Verification and references

- Choose SubagentSheet, command-inspection/activityDock, ToolInspectionPanel, backgroundStop, core apply and changed provider protocol suites; use fake output sources.
- Inspect changed UI in both themes, follow/selection and loading/retry states. Test native/Host output guards separately when changed; fixtures are not live-provider evidence.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Output behavior](../../../docs/guides/chat-artifacts-and-connected-files.md)
- [Execution authority](../../../docs/reference/host-runtime.md)
