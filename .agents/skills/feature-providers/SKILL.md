---
name: feature-providers
description: "Change provider/model discovery and enable policy, global/project defaults, accounts/sign-in, CLI setup/update/version checks or model handoff selection."
---

# Providers and models

Own provider settings and catalog/account workflows. Composer owns the submitted request and handoff UI; Host runtime owns captured process/operation writers, physical retirement and execution authority. Do not duplicate their protocols in provider preferences.

## Source entry points

Code paths below are repository-root relative.

- `src/features/providers/`
- `src/features/settings/ui/ProviderSettings.tsx`
- `src/integrations/harness/providers/`
- `src/shared/model/productProviderDefaults.ts`

## Workflow

1. Identify whether the issue is discovery, owner enable preference, picker visibility, scoped default/inheritance, entitlement, account lifecycle or CLI operation.
2. Trace the persisted setting and all affected pickers/consumers before changing enabled/default semantics. Preserve saved custom/versioned/native IDs and historical sessions.
3. Use existing account registration/sign-in and CLI operation owners; retain operation identity through navigation, dismissal, timeout and original cleanup.
4. Exercise empty/stale catalog, storage errors, remote Host authority, account changes and late results. For switching defects trace composer handoff preparation and Host retirement without adding another replay path.

## Preserve

- Host launcher discovery rechecks file identity and permissions before reusing a bounded, brief FX identity scan. Package-dependent Cursor/Pi checks stay fresh; clearing discovery fences late cache publication and never executes an unrelated binary.
- Hermes background completion waits have a deadline. A timeout is unknown completion; never mark delegated rows complete or continue from late manifest results. Retain original read ownership until settlement and retire the captured provider through its existing lifecycle.
- Parent reply completion does not prove delegated work finished. Keep the original
  execution and child tracking alive until real terminal evidence arrives; follow-up
  and Stop must still target that execution while the parent is idle.
- Installed catalog, machine enable policy, invocation visibility, account entitlement and selected session model are different facts. Remote models.list/capabilities remain authoritative for remote sessions.
- Retain bundled/useful old catalog data on discovery failure with truthful source/freshness/error; hidden providers and owner restrictions cannot be bypassed by toggles.
- Model preference defaults/inheritance and explicit reset keep their storage keys and error recovery. The last enabled model remains on; all-off lookup falls back to the catalog. Changing this policy requires all consumers updated together.
- Product defaults are catalog-aware, use the conversation's provider/account and remain below explicit saved choices, including Off. Do not persist inherited delegation as a manual selection. An independent advisor may use the main model. See [defaults decision](references/decisions.md).
- Delegation guidance names the selected models and how to call them; it never routes work to a model, a tool or delegation itself. See [routing decision](references/decisions.md).
- Native subagents stay inside the saved selection (`providerTurnInput`): Claude's Agent tool is forced to the one same-account Claude model or removed; Codex, Grok and OpenCode native subagents are off; other providers are not enforced yet. See [native decision](references/decisions.md).
- Preserve verified stable account identity, duplicate rejection, abort/temporary cleanup, defaults/pins and running-turn consequences on removal. Pending sign-in must not disappear silently on navigation.
- Visible probe timeout is not physical process completion or signed-out proof. Retain/coalesce original provider/profile work; dismissing an update notice does not cancel an update.
- Do not fabricate CLI cancellation or current version from catalog refresh. Binary path drafts, active/configured-next distinction and restart recovery remain explicit.

## Verification and references

- Choose changed provider catalog/preferences/account/update/control tests and affected picker/settings consumers. Process/transport changes additionally need the Host/native owner suites.
- Review affected UI in both themes and required widths, long/custom IDs and pending/error/retry states. A rendered SVG or mocked sign-in does not establish installed glyph visibility or live account acceptance.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Host process authority](../../../docs/reference/host-runtime.md)
- [Provider-switch behavior](../../../docs/guides/chat-artifacts-and-connected-files.md)
