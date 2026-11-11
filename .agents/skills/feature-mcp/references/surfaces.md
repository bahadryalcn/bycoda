# MCP surfaces

Code paths are repository-relative.

| Area                           | Owner                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outgoing list/forms            | `src/features/settings/ui/McpSettings.tsx`, `McpSettings.module.css`; Settings model/search; `src/features/projects/ui/SearchableProjectPicker.tsx` |
| Cache/parsing                  | `src/features/settings/model/mcpSettingsCache.ts`, `mcp.ts`                                                                                         |
| Native provider config/auth    | `src-tauri/src/mcp.rs`, `harness.rs`; registration in `lib.rs`                                                                                      |
| Incoming grant UI              | `src/features/settings/ui/ExternalMcpAccess.tsx`, `ExternalMcpAccess.module.css`                                                                    |
| Host tokens/HTTP/catalog/proxy | `host/mcp/mcp-tokens.ts`, `mcp-http.ts`, `mcp-entry.ts`, `mcp-proxy.ts`, `server.ts`                                                                |
| Native incoming RPC allowlist  | `src-tauri/src/remote.rs`                                                                                                                           |

## Operations and limits

- Outgoing native identifiers: `mcp_discover`, `mcp_add`, `mcp_set_enabled`, `claude_mcp_list` (returns `{ output, timedOut }`), `codex_mcp_list` (names and Codex `auth_status` only), `claude_mcp_add`, `claude_mcp_remove`, `mcp_provider_login`. Verify exact provider/scopes and current supported transport before showing actions.
- `mcp_set_enabled` in `src-tauri/src/mcp/enablement.rs` validates provider/scope/name/config path and expected enabled state. Codex and OpenCode update their native enabled fields; Claude Code updates the current project's `disabledMcpServers` list across same-name scopes. Unsupported provider toggles stay unavailable. The shared locked writer lives in `src-tauri/src/mcp/config.rs`; the add form is `src/features/settings/ui/McpAddServer.tsx`.
- Incoming owner RPCs: `mcp.tokens.create`, `mcp.tokens.list`, `mcp.tokens.revoke`. Keep owner-device credential, project/tool group/read-write bounds and expiry enforcement in the Host.
- Preserve current grant defaults and validation in source, including memory-only one-shot secret display and no secret in history. Unknown create outcome is not proof that nothing was issued.
- Follow current source for runtime-logs read-only scopes; do not silently widen an existing grant to resolve an empty tool group.
- Search/reveal text families include MCP connections, providers/scopes, Configured, Sign in, Show config, External MCP access, expiry and revoke. Use actual translation calls.
- No mobile management parity follows from generic MCP/remote support. If adding such a surface, inspect actual mobile routes and permission contracts.

## Focused checks

Start with colocated `mcpSettingsCache`, `mcp`, `McpSettings` and `ExternalMcpAccess` tests, Host token/auth/proxy tests, and Rust config tests for native changes. Browser sources include `tests/browser/settings/external-mcp.spec.ts` and Settings subview/layout scenarios; inspect their separate configs/ports.

Exercise full-array search with bounded continuous rendering, provider/scope identity, raw CLI health provenance, mixed auth capability, known/unknown-scope removal, JSON add validation, stale discovery, memory-only secret close/reopen, expiry while focused, unknown create and rejected/false revoke. Use isolated config/token stores; UI fixtures do not prove native CLI or authenticated Host behavior.
