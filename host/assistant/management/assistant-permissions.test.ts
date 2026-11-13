import { describe, expect, it, vi } from "vitest";
import {
  AssistantRoomActions,
  assistantCriticalApprovalRequired,
  assistantProjectMutationAllowed,
  assistantRoomMutationAllowed,
} from "./assistant-permissions";
import type { RoomManagementCall } from "./assistant-management-turn";

vi.mock("../../voice/voice-tools", () => ({
  voiceToolCatalog: () => [
    { family: "conversation", action: "files.read", annotations: { readOnlyHint: true } },
    { family: "conversation", action: "files.write", annotations: { readOnlyHint: false } },
  ],
}));
const call = (action = "files.write", projectId?: string): RoomManagementCall => ({
  action,
  projectId,
  family: "conversation",
  threadId: "thread",
  requestId: "request",
  input: {},
});

describe("explicit assistant authority", () => {
  it("critical mirror restrictions use the reviewed push destination", () => {
    const profile = {
      criticalExclusions: ["pushMain", "sendMessages"] as ("pushMain" | "sendMessages")[],
    };
    expect(
      assistantCriticalApprovalRequired(profile, {
        action: "git.push",
        input: { review: { targetRef: "refs/heads/main", localBranch: "feature" } },
      }),
    ).toBe(true);
    expect(
      assistantCriticalApprovalRequired(profile, {
        action: "git.push",
        input: { review: { targetRef: "refs/heads/feature", localBranch: "main" } },
      }),
    ).toBe(false);
    expect(
      assistantCriticalApprovalRequired(profile, {
        action: "git.merge",
        input: { review: { currentBranch: "main", source: "feature" } },
      }),
    ).toBe(true);
    expect(
      assistantCriticalApprovalRequired(profile, {
        action: "git.merge",
        input: { review: { currentBranch: "feature", source: "main" } },
      }),
    ).toBe(false);
    expect(assistantCriticalApprovalRequired(profile, { action: "git.merge", input: {} })).toBe(
      true,
    );
    expect(assistantCriticalApprovalRequired(profile, { action: "social.send" })).toBe(true);
    expect(
      assistantCriticalApprovalRequired({ criticalExclusions: [] }, { action: "social.send" }),
    ).toBe(false);
  });
  it("keeps legacy per-operation gates and rejects empty project scope", () => {
    expect(assistantProjectMutationAllowed({}, [])).toBe(true);
    expect(
      assistantProjectMutationAllowed({ permissionLevel: "projects", permissionProjectIds: [] }, [
        "p",
      ]),
    ).toBe(false);
    expect(
      assistantProjectMutationAllowed(
        { permissionLevel: "projects", permissionProjectIds: ["p"] },
        ["p", "other"],
      ),
    ).toBe(false);
    expect(assistantProjectMutationAllowed({ permissionLevel: "everything" }, [])).toBe(true);
  });
  it("Watch allows known reads and denies mutations and unknown tools", () => {
    expect(
      assistantRoomMutationAllowed({ permissionLevel: "watch" }, call("files.read", "p")),
    ).toBe(true);
    expect(
      assistantRoomMutationAllowed({ permissionLevel: "watch" }, call("files.write", "p")),
    ).toBe(false);
    expect(
      assistantRoomMutationAllowed({ permissionLevel: "watch" }, call("unclassified", "p")),
    ).toBe(false);
  });
  it("does not turn selected-project authority into application or shell authority", () => {
    const profile = { permissionLevel: "projects" as const, permissionProjectIds: ["p"] };
    expect(assistantRoomMutationAllowed(profile, call("files.write", "p"))).toBe(true);
    expect(assistantRoomMutationAllowed(profile, call("preferences.patch", "p"))).toBe(false);
    expect(assistantRoomMutationAllowed(profile, call("commands.run", "p"))).toBe(false);
    expect(
      assistantRoomMutationAllowed(profile, {
        ...call("files.write", "p"),
        input: { projectId: "other" },
      }),
    ).toBe(false);
    expect(assistantRoomMutationAllowed(profile, call("files.write"))).toBe(false);
  });
  it("Stop revokes captured direct-voice actions across Resume, while reads remain available", async () => {
    const actions = new AssistantRoomActions(
      async () => ({ permissionLevel: "everything" }),
      async () => false,
    );
    const captured = actions.capture(call("files.write", "p"), {
      environmentId: "host",
      deviceHash: "device",
      authorized: async () => true,
    });
    expect(await captured.authorized()).toBe(true);
    actions.stop();
    actions.resume();
    expect(captured.signal?.aborted).toBe(true);
    expect(await captured.authorized()).toBe(false);
    expect(await actions.allowed(call("files.read", "p"))).toBe(true);
  });
});
