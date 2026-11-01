# Workbench feature routing

Open only the relevant contract. Each linked skill owns its domain behavior;
shared shell composition does not require reading every feature card.

| Work | Contract |
| --- | --- |
| Project rail/groups/lifecycle | [Projects](../../feature-projects/SKILL.md) |
| Conversation list/pin/archive/filter | [Sidebar](../../feature-sessions-sidebar/SKILL.md) |
| File tree/actions | [Explorer](../../feature-explorer/SKILL.md) |
| File Preview/Source/scroll | [Markdown](../../feature-markdown-preview/SKILL.md) |
| Notes documents/library | [Notes](../../feature-notes/SKILL.md) |
| Search result scope/opening | [Search](../../feature-search/SKILL.md) |
| Recovered conversations | [Recovery](../../feature-session-recovery/SKILL.md) |
| Git repository review/actions | [Source control](../../feature-source-control/SKILL.md) |
| GitHub PR/issues/review | [GitHub](../../feature-inbox-github/SKILL.md) |
| Jira board/list/transitions | [Jira](../../feature-inbox-jira/SKILL.md) |
| Saved SSH targets/terminal tabs | [Servers](../../feature-servers/SKILL.md) |
| PTY rendering/lifetime | [Terminal](../../feature-terminal/SKILL.md) |
| Composer/queue/transcript action context | [Composer](../../feature-chat-composer/SKILL.md) |
| Background command output | [Command details](../../feature-command-details/SKILL.md) |
| Browser/devices/logs/tool navigation | [Conversation tools](../../feature-conversation-tools/SKILL.md) |
| Tasks/goals or multi-agent work | [Tasks](../../feature-tasks-goals/SKILL.md), [Crews](../../feature-crews/SKILL.md) |
| Social workflows | [Social](../../feature-social-media/SKILL.md) |
| Saved preferences | [Settings](../../feature-settings/SKILL.md), then its narrow feature |
| First-run guidance/tours | [Onboarding](../../feature-onboarding-guide/SKILL.md) |
| Generic components and theme roles | [Shared UI](../../feature-shared-ui/SKILL.md), [Theme](../../feature-theme-foundation/SKILL.md) |

Cross-cutting ownership and design details are maintained in
[the UI design system](../../../../docs/reference/ui-design-system.md),
[component catalog](../../../../docs/reference/ui-component-catalog.md) and
[Arc integration](../../../../docs/reference/arc-ui.md). Keep domain approval,
draft/persistence and recovery logic in its feature owner.
