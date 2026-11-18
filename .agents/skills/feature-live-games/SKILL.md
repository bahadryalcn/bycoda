---
name: feature-live-games
description: Use when changing TikTok LIVE game events, Halay rules, the broadcast overlay or OBS controls. Not for social accounts or posts; see feature-social-media.
---

# Live games

Own the desktop Live games control screen, the Host game and OBS lifecycle, and
the local browser-source overlay. The Host reduces incoming events and owns the
session and report. Desktop and OBS render the same Host state.

## Source starts

- Desktop: `src/features/live-games/` owns the control screen and game model.
- Host: `host/live-games/` owns connectors, state, overlay and AI tools.
- Wire schemas: `src/shared/model/host-contracts/live-games.ts`.
- Native: `src-tauri/src/remote/` allows supported owner RPC methods and
  `src-tauri/src/conversation_tools_bridge/` owns exact broadcast approval.

## Workflow

1. Trace the action from desktop RPC or the authenticated Conversation Tool to
   its Host method. Review the scope and separate game and OBS lifecycles.
2. Follow normalized events through the reducer, persisted state and presentation
   snapshots. Test changes with the demo connector before using public events.
3. Follow overlay URL creation through HTTP admission and SSE. Check both aspect
   ratios and the source used by OBS.
4. Verify readback and cancellation after switching channels or after an
   uncertain OBS response. Confirm real OBS setup separately from source tests.

## Preserve

- TikTok LIVE intake reads public events. Keep authentication cookies out of the
  connector and keep the optional Euler API key in Host credentials.
- Loopback and the overlay bearer token gate access. Keep the private overlay
  link, protected avatar paths and OBS credentials out of Conversation Tools.
- A game session can end independently of OBS. OBS start from chat requires
  exact native owner approval and current authority at dispatch.
- Gift rules replace the full list. Game settings patch only supplied fields.
- Report counts cover observed live events. Demo activity stays identifiable.

## Focused checks

- `pnpm exec vitest run src/features/live-games`
- `pnpm test:host host/live-games`
- `pnpm check:host-contracts`
- `node scripts/checks/check-feature-skills.mjs`

## References

- [Live games guide](../../../docs/guides/live-games.md) for the desktop and OBS workflow.
- [Live games integration](../../../docs/integrations/live-games.md) for transport and credentials.
- [Agent tools](../../../docs/reference/agent-tools.md) for conversation scope and discovery.
