import { expect, it, vi } from "vitest";
import { ConversationDesktopRelay } from "../conversation/conversation-desktop-relay";
import { dispatchConversationTools } from "./tools-conversation";

it("derives SSH permission from original session metadata, not another selected session", async () => {
  const principal = {
    kind: "session" as const,
    projectId: "project",
    sessionId: "original",
    provider: "codex",
  };
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  let mode = "full-access";
  const featureMeta = vi.fn(async (id: string) => {
    expect(id).toBe("original");
    return { session: { runtimeMode: mode } };
  });
  const dependencies = {
    conversationAccess: { authorization: () => ({}), principalForToken: async () => principal },
    engine: {
      store: {
        db: { withAuthorization: async (_scope: unknown, run: () => Promise<unknown>) => run() },
        project: async () => ({ cwd: "/project" }),
      },
    },
    conversationDesktop: relay,
    inHost: async () => false,
    featureMeta,
  };
  const request = {
    conversationPrincipal: principal,
    params: {
      action: "servers.ssh.execute",
      input: { id: "saved", requestId: "command", command: "pwd" },
    },
    token: "source-token",
    tokenHash: "source-hash",
    endResult: vi.fn(async () => undefined),
  };
  const pending = dispatchConversationTools(dependencies as never, request as never);
  let delivered: Record<string, unknown>[] = [];
  await vi.waitFor(async () => {
    delivered = await relay.take("native");
    expect(delivered).toHaveLength(1);
  });
  const id = String(delivered[0].id);
  expect(await relay.authorize(id, "servers.ssh.execute.permission", "native")).toEqual({
    authorized: true,
    fullAccess: true,
  });
  mode = "supervised";
  expect(await relay.authorize(id, "servers.ssh.execute.permission", "native")).toEqual({
    authorized: true,
    fullAccess: false,
  });
  await relay.finish(id, { state: "completed" }, undefined, "native");
  await pending;
  expect(featureMeta).toHaveBeenCalledTimes(2);
  relay.close();
});
