---
name: feature-live-stream
description: Use when changing TikTok LIVE event intake, live session totals, OBS control or the go-live flow to Social accounts. Not for social accounts or posts; see feature-social-media.
---

# Live streaming

Own the Live streaming section of the Social workspace, the Host live session and OBS lifecycle,
and the go-live flow that starts OBS against a Social account. bycoda ships no
built-in game or overlay; users build their own with AI. The Host counts incoming
events and owns the session and report.

## Source starts

- Desktop: `src/features/live-stream/` owns the control panel and session model; Social mounts the panel.
- Host: `host/live-stream/` owns connectors, session state, OBS and AI tools.
- Wire schemas: `src/shared/model/host-contracts/live-stream.ts`.
- Native: `src-tauri/src/remote/` allows supported owner RPC methods and
  `src-tauri/src/conversation_tools_bridge/` owns exact broadcast approval.

## Workflow

1. Trace the action from desktop RPC or the authenticated Conversation Tool to
   its Host method. Review the scope and separate live-reader and OBS lifecycles.
2. Follow normalized events through the session counter, persisted state and the
   status snapshot. Test changes with the demo connector before using public
   events.
3. Follow go-live through approval, the Social ingest preparation and OBS start.
   A missing `scene` resolves to the scene OBS shows when the request arrives.
4. Verify readback and cancellation after switching channels or after an
   uncertain OBS response. Confirm real OBS setup separately from source tests.

## Preserve

- TikTok LIVE intake reads public events. Keep authentication cookies out of the
  connector and keep the optional Euler API key in Host credentials.
- Keep OBS credentials, stream keys and avatar URLs out of Conversation Tools.
- A go-live request names one to six accounts. Orientation decides the canvas
  (TikTok and Instagram vertical via Aitum, the rest horizontal); several on a
  canvas share one `host/live-stream/relay.ts` ffmpeg process. Acquire every
  ingest before any relay or OBS output starts, roll back created broadcasts on
  failure, and keep stream keys out of journals, status and relay logs.
- Reading a channel can end independently of OBS. OBS start from chat requires
  exact native owner approval and current authority at dispatch.
- Report counts cover observed live events. Demo activity stays identifiable.

## Focused checks

- `pnpm exec vitest run src/features/live-stream`
- `pnpm test:host host/live-stream`
- `pnpm check:host-contracts`
- `node scripts/checks/check-feature-skills.mjs`

## References

- [Live streaming guide](../../../docs/guides/live-stream.md) for the desktop and OBS workflow.
- [Live streaming integration](../../../docs/integrations/live-stream.md) for transport and credentials.
- [Agent tools](../../../docs/reference/agent-tools.md) for conversation scope and discovery.
