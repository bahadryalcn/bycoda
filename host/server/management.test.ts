import { describe, expect, it, vi } from "vitest";
import { createManagementRuntime } from "./management";

type Dependencies = Parameters<typeof createManagementRuntime>[0];
const session = { kind: "session", projectId: "p", sessionId: "s", provider: "claude" } as const;
const operation = (action: string) => ({ action, input: {}, operationHash: "a".repeat(64) });

function runtime(runtimeMode: string) {
  const call = vi.fn(async () => ({ approved: false, operationHash: "a".repeat(64) }));
  const dependencies = {
    crews: {},
    assistant: { request: vi.fn() },
    engine: { store: { project: async () => ({ cwd: "/repo" }) } },
    featureSession: async () => ({ projectId: "p", session: { runtimeMode } }),
    conversationDesktop: { call },
  } as unknown as Dependencies;
  return { approve: createManagementRuntime(dependencies).approveManagementOperation, call };
}

describe("management approval in a coding session", () => {
  it("skips the native prompt for a Full access session", async () => {
    const { approve, call } = runtime("full-access");
    await expect(approve(operation("git.commit"), session, async () => true)).resolves.toEqual({
      approved: true,
      operationHash: "a".repeat(64),
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("asks the owner in other modes and for publication", async () => {
    for (const [mode, action] of [
      ["auto", "git.commit"],
      ["supervised", "files.write"],
      ["full-access", "git.push"],
      ["full-access", "social.send"],
    ]) {
      const { approve, call } = runtime(mode);
      await expect(approve(operation(action), session, async () => true)).resolves.toMatchObject({
        approved: false,
      });
      expect(call).toHaveBeenCalledOnce();
    }
  });

  it("never approves after the session authority was revoked", async () => {
    const { approve } = runtime("full-access");
    await expect(approve(operation("git.commit"), session, async () => false)).rejects.toThrow(
      "Conversation authority revoked.",
    );
  });
});
