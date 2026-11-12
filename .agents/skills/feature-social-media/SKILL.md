---
name: feature-social-media
description: "Use when changing Social accounts, audience, outreach, inbox and browser automation. Not for decision routing; see feature-decision-models."
---

# Social media workflow changes

Use for Social product workflows and their Host operations. Distinguish platform support, connection mode (API or browser), account identity, project grant, the account's autonomy level, suppression and the global stops. UI restyling or a draft never grants send authority.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/social/ui/SocialView.tsx` mounts the shell; `ui/shell/` holds the frame and screen map; `ui/command|content|audience|inbox|accounts/` hold the five screens; `ui/browser/` holds NEEDS_HUMAN and live view; `ui/common/` shared pieces.
- `src/features/social/model/`: `socialTools.ts` (AI-callable actions), `autonomy.ts` (levels and defaults), `audience.ts`, `outreach.ts`, `socialActions.ts` (RPC names). Hooks, `ui/socialBulk.ts` and draft/program models hold workflow state.
- `src/integrations/social/`: platform adapters, capabilities, reason codes, messaging, media and OAuth helpers. It must not import `features`.
- `host/social/core/`: action registry (`social-actions.ts`) and service API. `social.ts` only composes; add operations through the registry.
- `host/social/audience/`, `outreach/`, `inbox/`, `ai/`, `autonomy/`, `contacts/`, `rules/`, `execution/`, `store/`, `oauth/`, `token-connections/`, `email/`.
- `host/social/browser*` and `browser-layers/`: sessions, recipes, layered driver, NEEDS_HUMAN, live view. `host/social/social-programs.ts` and `social-program-*.ts`: campaign programs.
- `host/decision-models/`: decision gateway for the browser decision layer and AI tools (own skill: `feature-decision-models`).
- Contracts: `docs/integrations/social.md`, `social-programs.md`, `decision-models.md`.

## Preserve

- The full invariant list is in [Social contracts](references/contracts.md). Keep these summaries true when editing.

- Autonomy: levels `suggest` (default), `approve`, `autonomous`, per account and action. Only the owner sets `autonomous`; an AI principal at `autonomous` still obeys limits, hours, suppression and both stops.
- Suppression is the single send gate for every outbound path; new paths call it, never a copy.
- Consent is informational: no per-contact consent gate; imports never grant consent.
- NEEDS_HUMAN: captcha, verification, suspicious-login and login screens are reported only; no layer clicks, types or solves them.
- Driver order: free official API first, browser only where no API supports the operation and before send submission. Uncertain API results are never retried through the browser.
- Drafts, suggestions and previews prepare content only; sending, activating and autonomy changes need explicit authority. Session tools never hold owner-only operations.
- Recheck draft, account, policy and suppression before dispatch; never resend blindly.
- Assistant account access is owner-granted per account, default denied. Person delete and export are owner-only.
- Keep Host/account/project/thread identity, isolated queries and stale-result rejection across navigation.

## Workflow

1. Map the requested workflow to its selected Host/account/project and to the actual registry operation and policy implementation. Check whether the operation is a tool (`socialTools.ts`) or owner-only.
2. Trace all editor, review, bulk, recurring and AI entry points that share the operation; keep local draft and per-target result state.
3. Exercise supported/unsupported, denied/allowed, autonomy level, suppressed, failed/partial and ambiguous outcomes with isolated data. Provider mocks and fixtures do not establish live platform or send acceptance.
4. Update the named doc (`docs/integrations/social.md`, `social-programs.md`) when a contract or user-visible behavior changes.

## Focused checks

Listing a command here is not a passing result.

- `pnpm exec vitest run src/features/social/ui/SocialView.test.ts src/features/social/model`
- `pnpm exec vitest run src/features/social/ui/shell src/features/social/ui/command src/features/social/ui/content src/features/social/ui/audience src/features/social/ui/inbox src/features/social/ui/accounts`
- `pnpm exec vitest run src/integrations/social`
- `pnpm exec vitest run --config host/vitest.config.ts host/social`

Inspect populated, empty and long content, account switches during requests, recurring work, media review, suppressed recipients and partial bulk recovery.

## References

- [Social contracts](references/contracts.md) for the full preserve list: autonomy, grants, credentials, indexed queries and polling cursors.
- [Decisions](references/decisions.md) for owner decisions that set autonomy, consent, driver and browser rules.
- [Social integration](../../../docs/integrations/social.md) for screens, account modes, platforms, audience, outreach, email, suppression, autonomy and browser layers.
- [AI programs](../../../docs/integrations/social-programs.md) when changing campaigns, models, schedules or program dispatch.
- [Decision models](../../../docs/integrations/decision-models.md) when a browser or AI decision uses the gateway.
