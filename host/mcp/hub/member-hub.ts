import { narrowPublishedMcp } from "../../../src/integrations/harness/core/externalMcpLaunch";
import type { McpHub } from "./hub";

/** The hub as a provider launch sees it: the session id lets a member's allowlist apply. */
export type SessionMcpHub = {
  externalMcp(
    mcpUrl: string | undefined,
    projectId?: string,
    sessionId?: string,
  ): Promise<{ externalMcp: unknown } | undefined>;
};

/**
 * Narrows the published MCP servers to a crew member's allowlist. `allowlist` returns
 * undefined for a session without one. Without hub metadata an allowlist cannot be applied,
 * so the launch is refused rather than started with every server.
 */
export function memberMcpHub(
  hub: Pick<McpHub, "externalMcp">,
  allowlist: (sessionId: string) => Promise<readonly string[] | undefined>,
): SessionMcpHub {
  return {
    async externalMcp(mcpUrl, projectId, sessionId) {
      const published = await hub.externalMcp(mcpUrl, projectId);
      const allow = sessionId ? await allowlist(sessionId.replace(/#\d+$/, "")) : undefined;
      return allow ? narrowPublishedMcp(published, allow) : published;
    },
  };
}
