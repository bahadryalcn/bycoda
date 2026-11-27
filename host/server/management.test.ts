import { describe, expect, it, vi } from "vitest";
import { createManagementRuntime, sessionFullAccessCoversInbox } from "./management";

type Dependencies = Parameters<typeof createManagementRuntime>[0];
type Exclusion =
  | "pushMain"
  | "deleteProject"
  | "deleteSession"
  | "sendMessages"
  | "computerUse"
  | "spend";
const session = { kind: "session", projectId: "p", sessionId: "s", provider: "claude" } as const;
const operation = (action: string, input: Record<string, unknown> = {}) => ({
  action,
  input,
  operationHash: "a".repeat(64),
});
const push = (targetRef: string) => operation("git.push", { review: { targetRef } });
const merge = (currentBranch: string) => operation("git.merge", { review: { currentBranch } });

function runtime(
  runtimeMode: string,
  profile: () => Promise<{ criticalExclusions?: Exclusion[] }> = async () => ({
    criticalExclusions: [],
  }),
) {
  const call = vi.fn(async () => ({ approved: false, operationHash: "a".repeat(64) }));
  const dependencies = {
    crews: {},
    assistant: { request: vi.fn(), profile },
    engine: { store: { project: async () => ({ cwd: "/repo" }) } },
    featureSession: async () => ({ projectId: "p", session: { runtimeMode } }),
    conversationDesktop: { call },
  } as unknown as Dependencies;
  return { approve: createManagementRuntime(dependencies).approveManagementOperation, call };
}

const autoApproved = {
  approved: true,
  operationHash: "a".repeat(64),
  approvedBy: "sessionFullAccess",
};

describe("management approval in a coding session", () => {
  it("skips the native prompt for a Full access session and marks the approval", async () => {
    for (const op of [
      operation("git.commit"),
      push("refs/heads/feature"),
      push("refs/heads/main"),
      operation("social.send"),
    ]) {
      const { approve, call } = runtime("full-access");
      await expect(approve(op, session, async () => true)).resolves.toEqual(autoApproved);
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("asks the owner in other modes", async () => {
    for (const [mode, op] of [
      ["auto", operation("git.commit")],
      ["supervised", operation("files.write")],
      ["supervised", push("refs/heads/feature")],
      ["auto", operation("social.send")],
      // Desktop input keeps the computer-use permission mode's own gate.
      ["full-access", operation("desktop.act")],
    ] as const) {
      const { approve, call } = runtime(mode);
      await expect(approve(op, session, async () => true)).resolves.toMatchObject({
        approved: false,
      });
      expect(call).toHaveBeenCalledOnce();
    }
  });

  it("keeps the prompt for publication an owner exclusion holds", async () => {
    for (const [exclusions, op] of [
      [["pushMain"], push("refs/heads/main")],
      [["pushMain"], merge("main")],
      [["pushMain"], operation("git.merge")],
      [["sendMessages"], operation("social.send")],
      // No reviewed destination: the exclusion cannot be ruled out.
      [["pushMain"], operation("git.push")],
    ] as const) {
      const { approve, call } = runtime("full-access", async () => ({
        criticalExclusions: [...exclusions],
      }));
      await expect(approve(op, session, async () => true)).resolves.toMatchObject({
        approved: false,
      });
      expect(call).toHaveBeenCalledOnce();
    }
    const { approve, call } = runtime("full-access", async () => ({
      criticalExclusions: ["pushMain"],
    }));
    await expect(approve(push("refs/heads/feature"), session, async () => true)).resolves.toEqual(
      autoApproved,
    );
    await expect(approve(merge("feature"), session, async () => true)).resolves.toEqual(
      autoApproved,
    );
    expect(call).not.toHaveBeenCalled();
    const free = runtime("full-access");
    await expect(free.approve(merge("main"), session, async () => true)).resolves.toEqual(
      autoApproved,
    );
    expect(free.call).not.toHaveBeenCalled();
  });

  it("treats an unreadable exclusion mirror as every exclusion selected", async () => {
    const { approve, call } = runtime("full-access", async () => {
      throw new Error("profile unavailable");
    });
    await expect(
      approve(push("refs/heads/main"), session, async () => true),
    ).resolves.toMatchObject({ approved: false });
    expect(call).toHaveBeenCalledOnce();
  });

  it("never approves after the session authority was revoked", async () => {
    for (const op of [operation("git.commit"), push("refs/heads/feature")]) {
      const { approve } = runtime("full-access");
      await expect(approve(op, session, async () => false)).rejects.toThrow(
        "Conversation authority revoked.",
      );
    }
  });
});

describe("inbox writes in a Full access coding session", () => {
  const covers = (operation: Record<string, unknown>, exclusions?: Exclusion[]) =>
    sessionFullAccessCoversInbox(operation, async () => ({ criticalExclusions: exclusions }));

  it("covers every write when the owner saved no exclusion", async () => {
    for (const op of [
      { action: "comment" },
      { action: "jira-comment-images" },
      { action: "review" },
      { action: "pr-action", prAction: "merge" },
      { action: "reaction" },
      { action: "labels", mode: "set" },
    ])
      expect(await covers(op, [])).toBe(true);
  });

  it("keeps the prompt for what an exclusion holds", async () => {
    for (const action of ["comment", "jira-comment-images", "review"])
      expect(await covers({ action }, ["sendMessages"])).toBe(false);
    for (const prAction of ["merge", "squash", "rebase"])
      expect(await covers({ action: "pr-action", prAction }, ["pushMain"])).toBe(false);
    expect(await covers({ action: "pr-action", prAction: "close" }, ["pushMain"])).toBe(true);
    expect(await covers({ action: "comment" }, ["pushMain", "spend"])).toBe(true);
    expect(await covers({ action: "reaction" }, ["sendMessages", "pushMain"])).toBe(true);
  });

  it("treats an unsaved or unreadable mirror as every exclusion selected", async () => {
    expect(await covers({ action: "comment" })).toBe(false);
    expect(
      await sessionFullAccessCoversInbox({ action: "review" }, async () => {
        throw new Error("profile unavailable");
      }),
    ).toBe(false);
    expect(await covers({ action: "labels", mode: "set" })).toBe(true);
  });
});
