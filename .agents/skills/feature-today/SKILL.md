---
name: feature-today
description: Develop the personal Today / This week view (sessions, agent run time, active time, cost by project) and its opt-in provider summary; Usage owns the cost model, Activity the active minutes, Notes the daily note.
---

# Today

Owns the local-only Today and This week view in `src/features/today/`, shown on the Account screen whether or not the user is signed in. It adds no Host code: figures come from the Usage page's sources (provider log rows, recorded turns, model prices), active minutes from the activity feature, the summary from the user's own provider, and the result goes to a note.

## Source starts

- `src/features/today/index.ts`: public entry (`TodayView`, `useTodayData`, `summarizeToday`).
- `model/todayAggregate.ts`: pure day/week by project aggregation over the Usage analytics functions.
- `model/todaySummary.ts`: request text, cost estimate, one-shot call wrapper, daily note logic (all injected).
- `model/todayProvider.ts`: the only adapter to the harness text prompt and the notes API.
- `ui/TodayView.tsx` (figures, charts, project table), `ui/TodaySummaryPanel.tsx`, `hooks/useTodayData.ts`.

## Workflow

1. Change figures only by reusing `src/features/usage/model/` functions; never price or sum rows differently.
2. Change what leaves the machine only in `buildSummaryPrompt`, and keep the preview showing that exact string.
3. Wire providers and notes only in `todayProvider.ts`; tests inject fakes.
4. Run the focused checks.

## Preserve

- Nothing is sent without the Send click; building the preview and the estimate make no request.
- The request is metadata only (folder names, counts, durations, costs); titles are an opt-in; never message content, paths or file names.
- The estimate is shown before Send and is a rough character-based figure, labelled as an estimate.
- Project breakdown never goes to bycoda servers; this feature has no account or network code.
- Projects in a locked group stay hidden, as on the Usage page.
- The daily note is one per local day; saving is a separate click and appends rather than overwrites.

## Focused checks

- `pnpm exec vitest run src/features/today`

## References

- `docs/guides/today.md`: user behavior.
- `.agents/skills/feature-usage/SKILL.md`: cost model and provenance.
