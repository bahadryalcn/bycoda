---
name: feature-inbox-settings
description: "Change bycoda Inbox credential forms, connection status or provider visibility scope. Preserve saved/draft/verified identity, account-aware discovery and desktop-owned credentials."
---

# Inbox settings development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for Settings integration management for GitHub CLI, GitLab, Azure DevOps, Jira and Linear. Use [GitHub Inbox](../feature-inbox-github/SKILL.md) or [Jira Inbox](../feature-inbox-jira/SKILL.md) for browsing, comments, boards and mutations beyond configuration.

## Start here

- `src/features/settings/ui/InboxSettings.tsx`, `JiraSettings.tsx` and `InboxConnectionStatus.tsx` own provider forms/status.
- The cards render in Settings > Integrations (`src/features/settings/ui/integrations/`), next to the messaging cards owned by [Messaging](../feature-messaging/SKILL.md); the old `inbox` section id redirects there.
- `src/features/settings/ui/useInboxScopePreference.ts` and `InboxScopeCollection.tsx` own durable scope editing; provider models are under `src/features/inbox/model/`.
- Read [surfaces](references/surfaces.md) for native validation, Host/mobile access and relevant checks.

## Preserve

- Keep saved identity, editable draft, configured presence and verified access separate. Do not fabricate account names, timestamps or connectivity from stored configuration.
- Credential replacement validates before saving and retains the previous valid configuration on failure; clear secret drafts only for the matching successful action.
- Preserve visited panels, dirty forms and operation ownership across tabs/search reveal. Delay hidden discovery without discarding drafts or in-flight results.
- Scope writes use the latest owning-machine state, preserve unknown IDs, verify outcomes and retain retry; unavailable scope must not imply unrestricted access.
- Reject obsolete account/request generations. Same-account roster refresh retains last-good data; changed accounts must not inherit mismatched projects/boards/teams.
- Keep null/unrestricted and empty/none semantics distinct; Jira hidden project exclusions and explicit board allowlists are different policies.
- Background sync remains a separate default-off opt-in. Opening a page or refreshing visible data does not silently enable background polling.
- Preserve masked credentials/private email, accessible pending/error state, duplicate guards and desktop-owned Host/mobile enforcement; never use real secrets in logs or captures.

## Workflow and checks

1. Follow form/status/scope through model, native validate-before-save and downstream Inbox consumers; verify exact account/machine identity at each boundary.
2. Use stable shared controls for changing async labels and local errors specific to status/save/disconnect/discovery, retaining configured data after failed reads.
3. Choose the focused provider/UI suites in the map; exercise replacement failure, late discovery, same-/sibling scope updates and narrow/tab keyboard behavior with fake credentials.

## Read when needed

- Read [surfaces](references/surfaces.md) for source owners and operation identifiers.
- For shared Settings shell/search behavior also read [Settings](../feature-settings/SKILL.md).
