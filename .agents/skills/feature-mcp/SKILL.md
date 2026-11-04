---
name: feature-mcp
description: "Change bycoda outgoing MCP configuration or incoming local-Host token management. Preserve provider/scope identity, health provenance, one-time secrets and uncertain-result recovery."
---

# MCP settings development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for Settings MCP list/discovery/add/login/remove/config and External MCP access grants. Conversation Tools UI and protocol/runtime clients are separate scopes; read their feature skill only when those layers change.

## Start here

- `src/features/settings/ui/McpSettings.tsx` and `ExternalMcpAccess.tsx` own outgoing configuration and incoming grants.
- `src/features/settings/model/mcp.ts`, `mcpSettingsCache.ts`, native `src-tauri/src/mcp.rs` and Host `host/mcp-tokens.ts` own data/authority.
- Read [surfaces](references/surfaces.md) for operation identifiers, bridge boundaries and checks.

## Preserve

- Keep outgoing provider configurations separate from incoming local-Host access grants; a token-management RPC does not imply outgoing remote configuration support.
- Preserve exact provider/scope/name/config identity and applicable local-only picker restrictions. Same-name Claude health is not independently verified per-scope health.
- Configured/Disabled are configuration evidence; do not relabel them Connected from a saved file or unsupported health probe.
- Continuous rendering reveals cached full-array matches, preserving search, focus, expanded rows and scroll; it must not add network pages or repeat discovery/health per batch.
- Add/login/remove/config actions retain explicit intent, native confirmation/scope selection, validation, locked write/merge protection, duplicate guards and draft recovery.
- JSON/JSONC configuration edits preserve unrelated comments, property order and line endings through `src-tauri/src/mcp_jsonc.rs`. Resolve the existing symlink target, retain permissions, revalidate identity/content before publication, and keep recovery candidates after an uncertain native replacement. Invalid or duplicate-key configuration is never silently rewritten.
- Incoming grants retain owning local Host, project/tool/read-write scope, expiry validation and owner credential gates. Write scope is not send/publish approval.
- Secrets appear once in guarded memory, are absent from list results and stored hashed by the Host. Preserve loopback/header/env-var examples and private error handling.
- Unknown create outcome blocks blind resubmission until reconciled; revoke changes local state only on confirmed success. Retain expired/revoked history and last-good data after failed reads.

## Workflow and checks

1. Trace the edited outgoing command or incoming RPC through its actual native/Host dispatcher; do not infer capability from a type or similarly named method.
2. Use shared rows, overlays, stable async controls and local status/error provenance; keep both topic owners alive when switching views.
3. Run focused cache/model/UI or token-service checks from the map; exercise auth/scope/remove cancellation, stale refresh, expiry, unknown create and revoke failure using isolated config/grants.

## Read when needed

- Read [surfaces](references/surfaces.md) for source and test maps.
- Read [decision provenance](references/decisions.md) when changing continuous-list behavior; it does not authorize configuration or grant mutations.
