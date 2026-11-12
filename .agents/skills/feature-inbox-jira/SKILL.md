---
name: feature-inbox-jira
description: "Use when changing Jira Inbox boards, sprints and issue moves. Not for credentials; see feature-inbox-settings."
---

# Jira Inbox and board changes

Use for Jira work collection and board/detail interaction. Saved account/project/board configuration belongs to Inbox settings. Shared Inbox chrome also affects GitHub.

## Source starts

- `src/features/inbox/ui/JiraBoardView.tsx`, `InboxView.tsx`, `InboxDetail.tsx`: board, collection and issue detail.
- `src/features/inbox/model/jira.ts`, `jiraBoard.ts`, `jiraBoardProtocol.ts`: reads, identities and board operations.
- `src/features/settings/ui/JiraSettings.tsx`, `src-tauri/src/jira.rs`, `src-tauri/src/jira/`: scope, native discovery and transitions.
- `mobile/src/features/inbox/`: independently check mobile consumers when changing shared Jira contracts.

## Preserve

- Ordinary card click/tap opens detail. Start pointer capture only for an actual drag; preserve touch pan, threshold, drag-click suppression, keyboard Move and transition validation.
- Keep provider/board/sprint/filter identity, explicit allowed boards/hidden projects, retained selection/scroll and issue/comment drafts.
- Preserve bounded user-demand continuation and truthful loaded completeness; local slicing is not server pagination. Do not enable background refresh as part of layout work.
- Wide right detail and narrow detail/back must remain reachable without losing board position.
- Rank/move/sprint changes retain connected-account permissions, required fields, partial-failure reload and recovery. Never infer mutation support from read capability.

## Workflow

1. Trace list and board data through the actual typed/native route; identify the selected board and transition target.
2. Handle click/tap and drag as separate interaction paths; inspect shared Inbox details and mobile consumers if the contract changes.
3. Exercise loading/error/partial lists, real-pointer detail activation and permitted/blocked moves with disposable issues.

## Focused checks

Run `pnpm exec vitest run src/features/inbox/ui/JiraBoardView.test.ts src/features/inbox/model/jiraBoard.test.ts src/features/inbox/model/jiraBoardProtocol.test.ts` plus changed Inbox/settings/native consumers.
Use `tests/browser/inbox/jira-board.spec.ts` for real-pointer coverage; ensure detail opening is wired rather than a no-op callback. Cover below-threshold click, actual drag, touch pan, keyboard Move, narrow back and partial move failure.

## References

- [Jira integration](../../../docs/integrations/jira.md) for configured behavior and permissions.
- [Inbox settings](../feature-inbox-settings/SKILL.md) for connection/scope changes; [GitHub](../feature-inbox-github/SKILL.md) for shared shell changes.
- [Selected layout decisions](references/decisions.md) only when reconsidering paging/detail defaults.
