---
name: feature-mcp
description: "Use when changing MCP configuration and local Host access tokens. Not for tool navigation; see feature-conversation-tools."
---

# MCP settings development

Use for Settings MCP list/discovery/add/login/remove/config and External MCP access grants. Conversation Tools UI and protocol/runtime clients are separate scopes; read their feature skill only when those layers change.

## Source starts

- `src/features/settings/ui/McpSettings.tsx` and `ExternalMcpAccess.tsx` own the outgoing list and incoming grants; `McpServerDetail.tsx` is the per-server detail sheet, `hooks/useMcpHub.ts` loads Host state and runs OAuth, and `model/mcpCatalog.ts` merges provider rows with the Host inventory by alias.
- `src/features/settings/model/mcp.ts`, `mcpSettingsCache.ts`, native `src-tauri/src/mcp.rs` and Host `host/mcp/mcp-tokens.ts` own data/authority.
- Read [surfaces](references/surfaces.md) for operation identifiers, bridge boundaries and checks.

## Preserve

- Keep outgoing provider configuration, project credentials, bycoda OAuth and incoming local-Host grants under their respective owners.
- Hub-managed servers persist on their owning Host. Keep management scoped, revision-checked and separate from provider configuration, and omit launch details and credentials from inventory responses.
- Global discovery uses `globalOnly` on the selected computer. Project uses the project's owning computer and Host. Keep discovery caches scoped by computer and project. Claude enablement remains project-only. Global Codex/OpenCode writes retain exact config identity.
- Remote provider configuration runs on the owning computer's desktop runtime. With a reachable Host, keep hub inventory, project credentials and bycoda OAuth available when the remote provider configuration runtime is unavailable.
- Keep project HTTP headers and stdio environment values in the owning Host's vault. Return metadata only and apply values when new bycoda sessions load the server.
- Keep bycoda OAuth scoped to the owning Host and selected project. Inherit the global login until the project completes its own sign-in or explicitly disconnects.
- Preserve exact provider/scope/name/config identity and applicable local-only picker restrictions. Same-name Claude health is not independently verified per-scope health.
- `mcp_discover` returns `{ connections, warnings }`: a missing file configures nothing, but an existing unreadable or malformed one is a warning (path plus a content-free reason) that the list, picker and empty state must show instead of "no servers". Unchanged settled files are parsed once (`src-tauri/src/mcp/config_read.rs`, keyed by path, mtime and size).
- Configured/Disabled are configuration evidence; do not relabel them Connected from a saved file or unsupported health probe.
- Continuous rendering reveals cached full-array matches, preserving search, focus, expanded rows and scroll; it must not add network pages or repeat discovery/health per batch.
- Add/login/remove/config actions retain explicit intent, native confirmation/scope selection, validation, locked write/merge protection, duplicate guards and draft recovery.
- JSON/JSONC configuration edits preserve unrelated comments, property order and line endings through `src-tauri/src/mcp_jsonc.rs`. Resolve the existing symlink target, retain permissions, revalidate identity/content before publication, and keep recovery candidates after an uncertain native replacement. Invalid or duplicate-key configuration is never silently rewritten.
- Incoming grants retain owning local Host, project/tool/read-write scope, expiry validation and owner credential gates. Write scope is not send/publish approval.
- Secrets appear once in guarded memory, are absent from list results and stored hashed by the Host. Preserve loopback/header/env-var examples and private error handling.
- Unknown create outcome blocks blind resubmission until reconciled; revoke changes local state only on confirmed success. Retain expired/revoked history and last-good data after failed reads.

## Workflow

1. Trace the edited outgoing command or incoming RPC through its actual native/Host dispatcher; do not infer capability from a type or similarly named method.
2. Use shared rows, overlays, stable async controls and local status/error provenance; keep both topic owners alive when switching views.
3. Run focused cache/model/UI or token-service checks from the map; exercise auth/scope/remove cancellation, stale refresh, expiry, unknown create and revoke failure using isolated config/grants.

## Focused checks

Use the tests in the [surface map](references/surfaces.md) for the changed operation.

## References

- Read [surfaces](references/surfaces.md) for source and test maps.
- Read [decision provenance](references/decisions.md) when changing continuous-list behavior; it does not authorize configuration or grant mutations.
