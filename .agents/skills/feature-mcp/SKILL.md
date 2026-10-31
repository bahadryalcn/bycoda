---
name: feature-mcp
description: "MCP Settings inventory for provider connections, project/scope configuration, discovery/cache/Claude health, search/filter/continuous list, add/login/remove/config actions and external local-Host token grants, expiry/scopes/revoke/secret handling. Read before MCP management UI or workflow changes."
---

# MCP settings and external access

Manage outgoing provider MCP configurations and incoming client grants with clear
identity, status and authority. Keywords: MCP, connections, configured, connected,
Claude health, provider, scope, sign in, pagination, infinite scroll, External MCP
access, token, project, expiry, runtime-logs, revoke. Conversation Tools MCP parity
and generic protocol/runtime clients are separate scopes; see their feature cards.

## Scope, baseline and concurrency

T2 audit/design inventory, 2026-10-27, dirty shared
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Relevant history inspected:
`29d534f9f`, `cf3944cfb`, `3419af022`, `395e2b491`. Two supplied light captures,
11 records (four V+S, seven S), 16 surface/state families; two native read-only
reviewers and parent checks. Installed source inclusion UNKNOWN.

Register/design: `temp/local/2026-10-27-settings-mcp-audit/AUDIT.md` and REDESIGN.md.
Evidence: `temp/verification/2026-10-27-settings-mcp-audit/EVIDENCE.md`. Feature
claims API unavailable; available Git/worktree/native session state inspected.
This card is not a cross-machine lock. Coordinate shared owner files; preserve
current Settings/Voice/Policies/Skills, controls and native work.

## Owner decision

2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, exact quote:

> mcp ekranları bu şekilde pagination eklanmış ama infinite scroll olsun daha compact bir tasarım anlayışı zaten olur diye düşünüyorum ama buranında yeninden düzenlenmesi gerekebilir. Çok kötü yönetiliyor bence

Infinite scroll replaces numbered paging as the target. This supersedes current
eight-row presentation, not any permission/config/credential contract. Compact
topic/row/token refinements remain proposals. No remote management, automatic
login, config write, token issuance/revocation or new opening default selected.

## Surface inventory

Re-enumerate `src/features/settings`, `src-tauri/src`, `host`, `tests/browser`,
mobile route/settings/management and shared controls. Search MCP labels, exact
command/RPC identifiers and callers; path presence is not runtime acceptance.

| Surface                                                   | Source                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings entry/search/project scope                       | `src/features/settings/ui/SettingsView.tsx`; `src/features/settings/model/settings.ts`; `src/features/projects/ui/SearchableProjectPicker.tsx`                |
| Connection list/search/filter/rows/details/operations/Add | `src/features/settings/ui/McpSettings.tsx`; `McpSettings.module.css`                                                                                          |
| Discovery/cache/status parser                             | `src/features/settings/model/mcpSettingsCache.ts`; `mcp.ts`                                                                                                   |
| Shared controls/overlays                                  | `settingsControls.tsx`; shared Button, Select, Modal, Popover and ConfirmMorph                                                                                |
| Outgoing native configuration and CLI/auth                | `src-tauri/src/mcp.rs`; `harness.rs`; command registration in `lib.rs`                                                                                        |
| Incoming access UI/create/secret/history/revoke           | `src/features/settings/ui/ExternalMcpAccess.tsx`; `ExternalMcpAccess.module.css`                                                                              |
| Incoming Host grants/auth/HTTP/catalog/proxy              | `host/mcp-tokens.ts`; `mcp-http.ts`; `mcp-entry.ts`; `mcp-proxy.ts`; `host/server.ts`                                                                         |
| Native incoming RPC bridge                                | `src-tauri/src/remote.rs` exact token allowlist                                                                                                               |
| Mobile/remote boundaries                                  | No dedicated outgoing or token-management screen found in current mobile route/settings/management inventory; generic MCP/remote support is a different claim |

Outgoing native identifiers: `mcp_discover`, `mcp_add`, `claude_mcp_list`,
`claude_mcp_add`, `claude_mcp_remove`, `mcp_provider_login`. Incoming owner RPCs:
`mcp.tokens.create`, `mcp.tokens.list`, `mcp.tokens.revoke`, behind owner device
credential. Do not invent outgoing Host management support from token RPCs.

Translation copy families include MCP connections, Search MCP servers, Connection
details, Configured, Disabled, Sign in, Show config, Add MCP server, Scope,
External MCP access, Create token, Tool groups and scopes, Read/Write, expiry,
revoke, copy, pending/error/recovery. Search actual t(...) keys in locale/override
catalogs; no assumed mcp.* translation namespace.

## Behavior and truth to preserve

- Outgoing project picker is localOnly; remote:// has a clear recovery path.
  Providers/scopes: Claude local/project/user; Claude Desktop/Codex user; Cursor/
  OpenCode project/user. No new provider scopes or remote config mutation implied.
- Discovery returns the configured array; page slicing is local. Search covers
  full loaded name/provider/scope/transport/status/configPath; retained query/filter/
  provider preferences are project-keyed. Cache shares requests, rejects superseded
  health and does not delay discovery on health.
- Configured/Disabled are configuration evidence. Claude CLI health is name-based,
  not independently verified per-scope health. Keep exact row identity and raw CLI
  detail. Other provider configuration must not be relabeled Connected.
- Sign-in opens browser only explicitly on supported provider/transport. Claude
  remove retains native confirmation, scope selection for CLI-only rows, busyRef
  and exact row/action pending. Other providers retain Show config/manual removal.
- Add preserves JSON standard/single-entry parsing, provider/scope/name validation,
  duplicate refusal, config merging and locked temporary-write/rename protection.
  No lost draft or pending field/result confusion may be introduced by restyling.
- Incoming access always uses local-sync Host; cwd only preselects a Host project.
  Keep project/group/read-write bounds, default conversation/read + 30 days and
  1–366 day/nonempty scope validation. Write scope is not send/publish approval.
- Secret appears once in guarded memory-only UI; list returns no secret, Host
  stores hash only. Keep env-var examples, loopback endpoint/header transport,
  copy feedback, focus/close/duplicate guards and no raw RPC error payload display.
- Revoke uses shared inline ConfirmMorph, not native dialog; only revoked:true
  updates state. False/rejection keeps grant and retryable error. Host expiry and
  owner authentication remain authoritative regardless of stale client badges.

## Audit proposals and source repairs

Owner-selected continuous list progressively reveals cached matches near active
list end, not new backend pages or recurring health calls. Preserve stable focus,
expanded identities/scroll, generation and full-array search; retain stale rows on
failed refresh. Keep a named accessible fallback/end/retry state without requiring
routine page clicking. Do not bury External access below an ever-growing list.

Propose compact independent Connections / External access topic access, contextual
scope/status help, readable two-track rows and local grant search/status/history.
Keep form/one-shot secret lifecycle deliberate when changing topics. No new default.

Source repairs: pending object interpolation; raw-status success normalization;
name-only health provenance; failed-discovery last-good data; expiry display timing;
runtime-logs Write-only choice that exposes no tools. Never upgrade existing grants
to read or delete revoked/expired history to simplify UI. Unknown create outcome is
an unexercised acceptance risk: do not blind retry or re-reveal secret from a list.

## Checks and acceptance

Fresh audit baseline: McpSettings.test.ts, mcpSettingsCache.test.ts, mcp.test.ts,
ExternalMcpAccess.test.ts, 25 tests / four files pass. Static file detector for
both UIs/CSS returns []. Mocked native/remote commands do not establish real CLI,
config files, auth, grant security, expiry rendering or installed acceptance.

Relevant suites: those four unit files; `tests/browser/settings-subviews.e2e.ts`;
`tests/browser/external-mcp.spec.ts` and external-mcp fixture/config; Rust mcp tests;
`host/mcp-tokens.test.ts`, `mcp-http.test.ts`, `mcp-proxy.test.ts`,
`mcp-proxy-concurrency.test.ts`. Host/Rust/browser/mobile suites inspected, not run.
External browser spec still expects an old native confirmation counter while current
UI uses inline ConfirmMorph; update this expectation before claiming lifecycle proof.
Existing outgoing browser paging assertions do not validate continuous reveal.

Actual changed UI acceptance: light/dark1280/800 plus narrow390, long labels/paths,
zoom/type scale, reduced motion, keyboard/screen reader, list append/end/filter/
late health/stale refresh, details focus, Add pending, supported sign-in/removal,
local-only recovery, token create/unknown outcome/secret/copy/history/expiry/revoke.
Use isolated fake configs/CLI/Host/data; do not mint/revoke real credentials for
UI tests or put secrets in screenshots/logs. Native/installed/physical-device and
release acceptance are separate, not inferred from unit or diagram evidence.

## Handoff and evidence limits

Audit/card ready for review, product migration not started. No actual config/token/
credential read or operation, build/install/release. Native/Host/installed/mobile
acceptance pending. No new source commit; uncommitted inventory against baseline
above preserves concurrent work. Update user guides after behavior implementation.

## H3 Settings consumer implementation, 2026-10-28 (uncommitted)

McpSettings now progressively reveals cached matches in a bounded continuous
list with an accessible continuation fallback; it does not issue network pages
or repeat discovery per batch. Topic jump actions retain both Connections and
External access owners. Exact row keys, details, scope/provider distinctions,
explicit auth/removal and Add validation remain. Add has a synchronous in-flight
guard and immutable pending fields. Cache failure retains last-good rows with
error/retry; CLI status normalization preserves raw evidence and names its
same-name/per-scope limitation. Empty help Rows become contextual prose.

External grants gain local search/status/history and returned-set counts. Expiry
display updates at the next expiry and on focus without Host polling. New token
forms expose runtime-logs read-only choices; existing grants are untouched.
Unknown create outcome blocks resubmission in that form and refreshes history;
one-shot secrets remain memory-only and both topic owners stay mounted.

Test edilmedi under the nightly owner rule. Per-ID MC-01..11 delivery and morning
checks: `temp/local/2026-10-28-settings-pages-b/tooling.json`. No real MCP/config,
login/token/credential mutation, test/server/capture, build/install or release.

## V3-010 MCP page rows (2026-10-31)

Owner, 2026-10-31, with two MCP screenshots, exact quote:

> mcp sayfasında Configured sağda signin Solda olsa daha iyi olacak gibi hepsinde yok çünkü kaymalar oluyor. Bazılarında da silme işareti filan yok bunlarıda toparlıyalım todoya eklyelim ekranda hala gerekszi yazılar filan var. Onlarada bak

Delivered in source (uncommitted; handoff `temp/local/2026-10-31-ui-refinements-3/HANDOFF-v3-p2.md`; no runtime acceptance):
- Fixed action, status and menu columns so `Configured` no longer shifts. Sign in shows only for needs-authentication/unknown status; otherwise `Sign in again` is in the overflow menu. Every row's overflow menu has Show config, Copy config path and Remove; an unsupported Remove is disabled with a reason and writes nothing new.
- Claude CLI-only removal asks for the scope inside a Modal confirmation (selection retained, one pending request at a time, error/retry). Known-scope rows keep the central confirmation.
- Provider/scope/transport are one muted metadata line; the scope explanation is behind an InfoPopover (the `setting-mcp-scopes` search target is kept); the range line shows only while more rows remain.
- External connection examples help and refresh were kept (different functions); the token search is quiet. No grouping by name (proposal only).
- Skills (V3-009, `SkillsPage.tsx`): editable skills offer Edit / Preview / Split; the extra "Source" mode is gone for them. Read-only and managed skills keep Preview / Source / Split.
- Unverified: mixed Claude/Codex/Desktop alignment at 1280/800 and narrow containers, remove modal and menu keyboard focus.
