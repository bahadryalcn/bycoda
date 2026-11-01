# Inbox Settings surfaces

Paths are repository-relative. Configuration presentation does not grant provider write or credential-disclosure authority.

| Area | Starting points |
| --- | --- |
| Provider forms/tab lifecycle | `src/features/settings/ui/InboxSettings.tsx`, `InboxSettings.css`, `JiraSettings.tsx`, `InboxConnectionStatus.tsx` |
| Scope preferences | `src/features/settings/ui/useInboxScopePreference.ts`, `InboxScopeCollection.tsx`; follow Settings reveal IDs in `src/features/settings/model/settings.ts` |
| Models/caches | `src/features/inbox/model/githubTasks.ts`, `gitlab.ts`, `azureDevOps.ts`, `jira.ts`, `jiraBoard.ts`, `linear.ts` |
| Consumers | `src/features/inbox/ui/InboxView.tsx`, `JiraBoardView.tsx`; model `useInboxUnseen.ts` and current scope subscribers |
| Native config | `src-tauri/src/fs.rs`, `gitlab.rs`, `azure_devops.rs`, `linear.rs`, `jira.rs`, `jira/board.rs`; registrations in `lib.rs` |
| Host bridge | `host/provider-inbox.ts`, `host/conversation-workspace-tools.ts`; follow the current remoteInbox client |
| Mobile | `mobile/app/(tabs)/inbox.tsx`; `mobile/src/features/inbox/provider-inbox-screen.tsx`, `provider-list.tsx`, `provider-protocol.ts`; desktop Jira bridge and `src-tauri/src/jira/mobile_board.rs` |

## Operations and identity

- GitHub CLI status: `git_github_status`; GitLab `gitlab_status/gitlab_set_config`; Azure DevOps `azure_devops_status/azure_devops_set_config`; Linear `linear_status/linear_set_token/linear_list_teams`; Jira `jira_status/jira_set_config/jira_list_projects/jira_list_boards`.
- Confirm current command arguments and native validation before changing forms. An empty credential may mean explicit disconnect; a failed status read must not become a save/disconnect failure or erase saved state.
- Host typed availability/items use `inbox.providers.status/list` and `inbox.provider.status/request/result`. These are not arbitrary Tauri credential commands or a saved-token disclosure API.
- Jira mobile access remains under `inbox.jiraBoard.v1`, desktop-owned account/allowlist enforcement and current source identity. A phone consumer is not a credential manager.
- Existing roster paging/cursor guards are model/native contracts; do not infer first-page incompleteness merely from bounded UI rendering.

## Focused checks

Use colocated InboxSettings/JiraSettings tests and changed provider-model tests (`gitlab`, `azureDevOps`, `linear`, `jira`, `githubTasks.providers`, `jiraBoard`, `jiraMobileBridge`). Relevant Settings browser subview/layout scenarios cover visual composition.

Cover saved versus draft URLs, token reveal, failed replacement retaining old config, successful-only secret clearing, reconnect account epochs, roster refresh failures, hidden/visited tabs, unknown IDs, none/unrestricted semantics, write/readback/sibling recovery and background-sync independence. Test provider network/native/mobile permissions separately with isolated accounts/data.
