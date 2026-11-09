import { measurePayloads } from "../scripts/checks/context-metrics.mjs";
import {
  buildThreadTitlePrompt,
  SKILL_INVOCATION_GUIDANCE,
  fullToolCatalog,
  SessionSyncSchema,
  RpcSuccessResponseSchema,
} from "./production";

export function contextMetrics() {
  const sync = SessionSyncSchema.parse({
    kind: "snapshot",
    value: {
      projectId: "project-demo",
      revision: 1,
      status: "idle",
      updatedAt: 0,
      session: {
        id: "session-demo",
        title: "Oturum bağlantıları",
        blocks: [{ id: "block-demo", text: "Bağlantı hatası 🙂" }],
      },
    },
  });
  const response = RpcSuccessResponseSchema.parse({
    jsonrpc: "2.0",
    id: "client-demo/1/1",
    result: sync,
  });
  return {
    provenance:
      "Deterministic sanitized fixtures using imported production prompt, guidance, MCP tool schemas and validated Host DTOs; never sampled live traffic",
    boundaries:
      "Each entry is a distinct measurement boundary. A thread snapshot is nested inside its WS JSON response; do not sum these into total network or model context. UTF-8 excludes WebSocket/TLS/HTTP framing and compression. Provider entries measure actual prompt text, not a provider-specific request envelope.",
    ...measurePayloads([
      {
        id: "title-prompt",
        layer: "provider-context",
        source: "src/features/sessions/model/sessionTitle.ts#buildThreadTitlePrompt",
        serialization: "raw prompt text (UTF-8)",
        serialized: buildThreadTitlePrompt("Fix session links in PR #42"),
      },
      {
        id: "skill-guidance",
        layer: "provider-context",
        source: "src/integrations/harness/core/skillGuidance.ts#SKILL_INVOCATION_GUIDANCE",
        serialization: "raw instruction text (UTF-8)",
        serialized: SKILL_INVOCATION_GUIDANCE,
      },
      {
        id: "conversation-tool-catalog",
        layer: "mcp-context",
        source: "host/conversation/conversation-tools.ts#conversationToolCatalog",
        serialization: "JSON.stringify({tools:conversationToolCatalog()})",
        serialized: JSON.stringify({ tools: fullToolCatalog }),
      },
      {
        id: "session-sync-snapshot",
        layer: "thread-transfer",
        source: "src/shared/model/host-contracts/session-reads.ts#SessionSyncSchema",
        serialization: "JSON.stringify(validated SessionSync)",
        serialized: JSON.stringify(sync),
      },
      {
        id: "session-sync-ws-response",
        layer: "websocket-message",
        source: "src/shared/model/host-contracts/schemas.ts#RpcSuccessResponseSchema",
        serialization: "JSON.stringify(validated RpcSuccessResponse)",
        serialized: JSON.stringify(response),
      },
    ]),
  };
}
