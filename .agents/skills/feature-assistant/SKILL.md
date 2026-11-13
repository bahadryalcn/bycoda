---
name: feature-assistant
description: Use when changing Assistant Room, jobs, Chief and presence. Not for task execution; see feature-tasks-goals.
---

# Assistant

Own Assistant Room, profile, supervision, memory and delivery across `src/features/assistant/` and `host/assistant/`, with native presence and control adapters. Mobile Room belongs to the nested mobile repository; [voice](../feature-voice/SKILL.md), [tasks](../feature-tasks-goals/SKILL.md) and [Host](../feature-host-runtime/SKILL.md) retain their execution contracts.

Model order, pools, role bindings and delegation defaults belong to [model routing](../feature-model-routing/SKILL.md) in Settings > Work. Feature choices resolve at run start; existing running sessions keep their concrete model.

## Source starts

- UI/model: `src/features/assistant/`; Room composition is `ui/AssistantView.tsx`.
- Host: `host/assistant/`; public domain entry is `host/domains/assistant/service.ts`.
- Native: `src-tauri/src/assistant/` and `src-tauri/src/control/`, plus the sibling presence adapter; [source owners](references/sources.md) identifies its entry.
- Mobile: `mobile/src/features/assistant/`; read nested rules before changes.

## Workflow

1. Locate the Room, job, Chief or presence owner in the [source map](references/sources.md).
2. Trace original Host, source, scope, authority, storage and receipts through UI, service and native adapters; keep the operation target separate from Room identity.
3. Read the relevant contract reference below. Keep drafts, permission owners, cancellation and uncertain outcomes before changing admission or recovery.
4. Exercise focused suites, stale callbacks, reconnect, unreadable presence and unknown outcomes; separate source, fixture, provider and installed evidence in the handoff.

## Preserve

- Only explicit owner action opens the microphone. Return from sleep keeps it closed; explicit Disconnect fences retries and callbacks without stopping Host work.
- Availability is never unknown: an unreadable computer is away, an unreachable Host is offline, and a failed read keeps the last confirmed state.
- Room threads are project-independent. Effects retain original Host, registered thread, live window issuer and exact target across waits; labels/aliases never replace identity.
- Profiles, names, rules, quoted preferences and sockets grant no approval authority. Report, jobs, Chief, manual sessions and reviewers retain separate write owners.
- Persist intent before dispatch; retain drafts, in-flight operations and unknown delivery across reconnect/restart. Never replay uncertain effects under a fresh ID.
- Chief admission requires saved Chief mode. Jobs own only exact job goals and durable session links; original provider, cwd, run and authority generation survive awaits.
- Withdrawal fences supervision across restart without stopping canonical workers or erasing authorship. Deletion and restoration retain exact task/run review boundaries.
- Owner choices are data, never approval. Keep source/version/prompt/options, request identity, whole-question postponement and lost-acknowledgement recovery.
- Budgets reserve local capacity; missing usage is incomplete. Separate manual and assistant holds; priority grants no bypass/preemption and keep-awake remains opt-in.
- Summaries and Notes retain canonical provenance, saved artifacts and contributor privacy through model reads, history and speech. Native delivery needs its receipt.
- Desktop input requires exact native approval, physical-input consent and current presence. Stop/revocation fences queued effects; audit retries cannot perform input.
- Observation subscriptions and privileged native proofs require their own admission; device pairing, Room identity and background delivery grant no new trust or consent.

## Focused checks

Use `pnpm exec vitest run src/features/assistant` and `pnpm exec vitest run --config host/vitest.config.ts host/assistant` for affected folders; select narrower paths when possible. Use normal `tsc-rs` project commands. Presence changes also need relevant Rust tests and Windows lock/unlock acceptance. UI changes need tier-required light/dark captures. Mock sockets do not prove Wi-Fi recovery or acoustics; source is not installed acceptance.

## References

- [Source owners](references/sources.md): locate UI, service, native and mobile seams.
- [Room, capture and delivery](references/room-and-delivery.md): identity, drafts, memory, presence, notebook, observations and desktop effects.
- [Supervision](references/supervision.md): job/Chief admission, budgets and recovery.
- [Decision provenance](references/decisions.md): owner decisions for the messaging conversation layout.
- [Setup/profile controls](references/setup.md): editing, explicit Save and model identity.
- [Observation admission](../../../docs/reference/assistant-observations.md): journal coverage, cursors and native source permits.
- [Native admission](../../../docs/reference/assistant-native-admission.md): privileged proof provisioning, revocation and signed operation scope.
- [Assistant guide](../../../docs/guides/assistant.md) and [voice guide](../../../docs/guides/voice.md): user-visible behavior changes.
