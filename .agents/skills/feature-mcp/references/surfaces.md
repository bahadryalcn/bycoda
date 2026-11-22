# MCP surfaces

Code paths are repository-relative.

| Area                           | Owner                                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outgoing list/forms            | `src/features/settings/ui/McpSettings.tsx` (list), `McpServerDetail.tsx` (detail sheet), `McpServerConfigEditor.tsx` (entry editor), `McpSettings.module.css`; Settings model/search; `src/features/projects/ui/SearchableProjectPicker.tsx` |
| Host loading and OAuth hook    | `src/features/settings/hooks/useMcpHub.ts`; provider rows merged with the Host inventory by alias in `src/features/settings/model/mcpCatalog.ts`                                                                                             |
| Cache/parsing                  | `src/features/settings/model/mcpSettingsCache.ts`, `mcp.ts`                                                                                                                                                                                  |
| Native provider config/auth    | `src-tauri/src/mcp.rs`, `harness.rs`; registration in `lib.rs`                                                                                                                                                                               |
| Incoming grant UI              | `src/features/settings/ui/ExternalMcpAccess.tsx`, `ExternalMcpAccess.module.css`                                                                                                                                                             |
| Host tokens/HTTP/catalog/proxy | `host/mcp/mcp-tokens.ts`, `mcp-http.ts`, `mcp-entry.ts`, `mcp-proxy.ts`, `server.ts`                                                                                                                                                         |
| Native incoming RPC allowlist  | `src-tauri/src/remote.rs`                                                                                                                                                                                                                    |

## Operations and limits

- Managed Hub definitions use the owner RPC `mcp.hub.servers` and the Host registry in `host/mcp/hub/managed-servers.ts`. Add stores a new definition, update and enablement require its revision, and remove requires the current revision and scope. Managed HTTP runs through Host conversation tools.

- Outgoing native identifiers: `mcp_discover`, `mcp_add`, `mcp_set_enabled`, `claude_mcp_list` (returns `{ output, timedOut }`), `codex_mcp_list` (names and Codex `auth_status` only), `claude_mcp_add`, `claude_mcp_remove`, `mcp_provider_login`, `mcp_server_config_read`, `mcp_server_config_write`. Verify exact provider/scopes and current supported transport before showing actions.
- `mcp_set_enabled` in `src-tauri/src/mcp/enablement.rs` validates provider/scope/name/config path and expected enabled state. Codex and OpenCode update their native enabled fields; Claude Code updates the current project's `disabledMcpServers` list across same-name scopes. Unsupported provider toggles stay unavailable. The shared locked writer lives in `src-tauri/src/mcp/config.rs`; the add form is `src/features/settings/ui/McpAddServer.tsx`.
- Incoming owner RPCs: `mcp.tokens.create`, `mcp.tokens.list`, `mcp.tokens.revoke`, `mcp.hub.loading.get` (also returns the secret-free hub inventory: name, kind, sources, aliases, signed-in; never command, env, url or headers), `mcp.hub.loading.set` (hub loading policy, refuses writes while the file is corrupt). Keep owner-device credential, project/tool group/read-write bounds and expiry enforcement in the Host.
- Preserve current grant defaults and validation in source, including memory-only one-shot secret display and no secret in history. Unknown create outcome is not proof that nothing was issued.
- Follow current source for runtime-logs read-only scopes; do not silently widen an existing grant to resolve an empty tool group.
- Search/reveal text families include MCP connections, providers/scopes, Configured, Sign in, Show config, External MCP access, expiry and revoke. Use actual translation calls.
- No mobile management parity follows from generic MCP/remote support. If adding such a surface, inspect actual mobile routes and permission contracts.

- Host-held OAuth for HTTP servers: owner RPCs `mcp.oauth.start|status|signOut` (`host/mcp/hub/oauth/`, UI in `hooks/useMcpHub.ts`). The server URL comes from the Host inventory; credentials live only in the encrypted secrets vault, the index holds no secret. A signed-in http server loads on demand like a hub-hosted one. Tests: `host/mcp/hub/oauth/oauth.test.ts`.
- Per-file configuration editor: native `mcp_server_config_read` and `mcp_server_config_write` (`src-tauri/src/mcp/server_config.rs`), used by `McpServerConfigEditor.tsx`. The write is refused when the file changed on disk after it was read.
- Remote provider files: `src/features/settings/model/mcpConfigTarget.ts` calls owner RPC `mcp.config.call` (`host/mcp/native-config.ts`). The Host resolves the registered project and delegates supported operations to the owning computer's desktop runtime (`src-tauri/src/mcp/remote_config.rs`). Use the bycoda Host's OAuth flow for remote sign-in.
- Project credentials: `src/features/settings/ui/McpProjectCredentials.tsx` issues owner RPCs through `src/features/settings/hooks/useMcpHub.ts`. `host/mcp/hub/project-credentials.ts` stores HTTP headers and stdio environment values in the owning Host's vault, scoped by project and server. Settings receives credential status without values.

## Focused checks

Start with colocated `mcpSettingsCache`, `mcp`, `McpSettings` and `ExternalMcpAccess` tests, Host token/auth/proxy tests, and Rust config tests for native changes. Browser sources include `tests/browser/settings/external-mcp.spec.ts` and Settings subview/layout scenarios; inspect their separate configs/ports.

Exercise full-array search with bounded continuous rendering, provider/scope identity, raw CLI health provenance, mixed auth capability, known/unknown-scope removal, JSON add validation, stale discovery, memory-only secret close/reopen, expiry while focused, unknown create and rejected/false revoke. Use isolated config/token stores; UI fixtures do not prove native CLI or authenticated Host behavior.
