import { beforeEach, expect, it, vi } from "vitest";
import { applyWorkspaceRewind, planWorkspaceRewind } from "./rewindClient";
import type { SessionRewindPlan } from "./contracts";
import type { Session } from "../../sessions/model/session";

const request = vi.hoisted(() => vi.fn());
const remote = vi.hoisted(() => vi.fn());
const capabilities = vi.hoisted(() => vi.fn());
const binding = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => vi.fn());
const persist = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
vi.mock("../../sessions/data/sessionStore", () => ({ upsertSession: persist, getSession: load }));
vi.mock("./workspaceClient", () => ({
  workspaceRequest: request,
  getWorkspaceCapabilities: capabilities,
  resolveWorkspaceContext: async () => ({ machineId: "machine" }),
}));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: remote,
  remoteSessionFor: binding,
}));
const session = {
  id: "session",
  cwd: "remote://env/repo",
  blocks: [{ id: "owner", role: "user", text: "Hello" }],
} as Session;
const plan: SessionRewindPlan = {
  token: "plan",
  expiresAt: Date.now() + 100000,
  direction: "rewind",
  workspaceId: "workspace",
  sessionId: "session",
  userBlockId: "owner",
  expectedRevision: 8,
  expectedConversationRevision: 12,
  branchRef: "refs/heads/bycoda/s/work",
  currentHead: "abc",
  targetHead: "def",
  statusFingerprint: "status",
  removedUserBlockIds: ["owner"],
  affectedCommits: ["abc"],
  affectedPaths: ["src/app.ts"],
  blockers: [],
  published: false,
  merged: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  persist.mockResolvedValue({ id: "session" });
  binding.mockReturnValue(undefined);
  capabilities.mockResolvedValue(["sessions.git-rewind.v1", "sessions.git-rewind-undo.v1"]);
  remote.mockResolvedValue({ revision: 12, session });
  request.mockImplementation(async (method: string) =>
    method === "workspaces.get" ? { revision: 8 } : plan,
  );
});
it("binds a rewind preview to fresh workspace and conversation revisions", async () => {
  await expect(
    planWorkspaceRewind(session, "workspace", { userBlockId: "owner" }),
  ).resolves.toEqual(plan);
  expect(request).toHaveBeenLastCalledWith(
    "sessions.rewind.plan",
    {
      workspaceId: "workspace",
      sessionId: "session",
      expectedRevision: 8,
      expectedConversationRevision: 12,
      direction: "rewind",
      userBlockId: "owner",
    },
    { cwd: "remote://env/repo" },
  );
});
it("requires the undo capability before requesting an undo preview", async () => {
  capabilities.mockResolvedValue(["sessions.git-rewind.v1"]);
  await expect(
    planWorkspaceRewind(session, "workspace", { operationId: "rescue" }),
  ).rejects.toThrow("Update bycoda Host");
  expect(request).not.toHaveBeenCalled();
});
it("does not apply blocked or expired plans", async () => {
  for (const invalid of [
    { ...plan, blockers: ["Uncaptured file"] },
    { ...plan, expiresAt: 1 },
  ])
    await expect(applyWorkspaceRewind(session, invalid, "stable-key")).rejects.toThrow(
      "blocked or expired",
    );
  expect(request).not.toHaveBeenCalled();
});
it("reconciles only the receipt revision and resets provider binding", async () => {
  request.mockResolvedValue({ conversationRevision: 13, operationId: "op", undoOperationId: "op" });
  remote.mockResolvedValue({
    revision: 13,
    session: { ...session, blocks: [], providerSessionId: "old-provider" },
  });
  const result = await applyWorkspaceRewind(session, plan, "stable-key");
  expect(request).toHaveBeenCalledWith(
    "sessions.rewind.apply",
    expect.objectContaining({
      planToken: "plan",
      expectedRevision: 8,
      expectedConversationRevision: 12,
      idempotencyKey: "stable-key",
    }),
    { cwd: "remote://env/repo" },
  );
  expect(result.session.blocks).toEqual([]);
  expect(result.session.providerSessionId).toBeUndefined();
});
it("holds an acknowledged rewind whose transcript has not synchronized", async () => {
  request.mockResolvedValue({ conversationRevision: 13 });
  await expect(applyWorkspaceRewind(session, plan, "stable-key")).rejects.toThrow(
    "has not synchronized",
  );
});
it("uses the host conversation identity while preserving the local shell and remote paths", async () => {
  binding.mockReturnValue("host-session");
  await planWorkspaceRewind(session, "workspace", { userBlockId: "owner" });
  expect(request).toHaveBeenLastCalledWith(
    "sessions.rewind.plan",
    expect.objectContaining({ sessionId: "host-session" }),
    { cwd: "remote://env/repo" },
  );
  request.mockResolvedValue({ conversationRevision: 13 });
  remote.mockResolvedValue({
    revision: 13,
    session: { ...session, id: "host-session", cwd: "/host/repo" },
  });
  const result = await applyWorkspaceRewind(
    session,
    { ...plan, sessionId: "host-session" },
    "stable-key",
  );
  expect(remote).toHaveBeenLastCalledWith(
    "machine",
    "sessions.get",
    { sessionId: "host-session" },
    false,
    true,
  );
  expect(result.session.id).toBe("session");
  expect(result.session.cwd).toBe("remote://env/repo");
});

it("uses native conversation revisions and native receipt reconciliation for local sessions", async () => {
  const local = { ...session, cwd: "/repo", workspaceId: "workspace" };
  capabilities.mockResolvedValue(["sessions.git-rewind.v1", "sessions.native-rewind.v1"]);
  native.mockImplementation(async (command: string) => {
    if (command === "session_get") return { transcriptRevision: 12 };
    if (command === "managed_rewind_plan") return plan;
    return { conversationRevision: 13, operationId: "op" };
  });
  expect(await planWorkspaceRewind(local, "workspace", { userBlockId: "owner" })).toEqual(plan);
  expect(persist).toHaveBeenCalledWith({ ...local, workspaceRevision: 8 });
  expect(native).toHaveBeenCalledWith("managed_rewind_plan", {
    request: expect.objectContaining({
      sessionId: "session",
      expectedConversationRevision: 12,
      expectedRevision: 8,
    }),
  });
  expect(remote).not.toHaveBeenCalled();
  native.mockImplementation(async (command: string) =>
    command === "session_get"
      ? { transcriptRevision: 13 }
      : { conversationRevision: 13, operationId: "op" },
  );
  load.mockResolvedValue({ ...local, blocks: [] });
  const applied = await applyWorkspaceRewind(local, plan, "stable-native-key");
  expect(native).toHaveBeenCalledWith("managed_rewind_apply", {
    request: expect.objectContaining({ idempotencyKey: "stable-native-key", planToken: "plan" }),
  });
  expect(applied.session.blocks).toEqual([]);
  expect(remote).not.toHaveBeenCalled();
});

it("keeps local managed rewind unavailable without native receipt capability", async () => {
  await expect(
    planWorkspaceRewind({ ...session, cwd: "/repo" }, "workspace", { userBlockId: "owner" }),
  ).rejects.toThrow("Update bycoda Host");
  expect(native).not.toHaveBeenCalled();
});
