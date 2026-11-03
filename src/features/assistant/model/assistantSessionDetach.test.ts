import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  current: true,
  locked: new Set<string>(),
  request: vi.fn(),
  capture: vi.fn(),
  owner: { environmentId: "host-a", session: vi.fn(), projects: vi.fn() },
}));
vi.mock("./assistantClient", () => ({
  assistantRequest: (...args: unknown[]) => state.request(...args),
}));
vi.mock("./assistantHostRead", () => ({
  captureAssistantHostRead: (...args: unknown[]) => state.capture(...args),
}));
vi.mock("../../group-lock/model/groupLock", () => ({
  isProjectLocked: (cwd: string) => state.locked.has(cwd),
}));
import { prepareAssistantSessionDetach } from "./assistantSessionDetach";
const input = () => ({
  sessionId: "session",
  cwd: "/project",
  environmentId: "host-a",
  management: { assistant: true as const, managedAt: 1, jobId: "job" },
  current: () => state.current,
});
beforeEach(() => {
  state.current = true;
  state.locked.clear();
  state.request.mockReset();
  state.capture.mockReset();
  state.owner.session.mockReset();
  state.owner.projects.mockReset();
  state.capture.mockResolvedValue(state.owner);
  state.owner.session.mockResolvedValue({
    projectId: "project",
    session: { id: "session", cwd: "/project" },
  });
  state.owner.projects.mockResolvedValue([
    { id: "project", path: "/project" },
    { id: "other", path: "/other" },
  ]);
  state.request.mockImplementation(async (request) =>
    request.op === "jobs.get"
      ? {
          job: {
            id: "job",
            version: 7,
            goalId: "assistant-job",
            projectId: "project",
            projectIds: ["project", "other"],
            sessionIds: ["session"],
          },
        }
      : { ok: true },
  );
});
it("captures the exact original Host and job version, then removes only that session", async () => {
  const source = await prepareAssistantSessionDetach(input());
  expect(source.write).toEqual({
    op: "sessions.detach",
    jobId: "job",
    sessionId: "session",
    expectedVersion: 7,
  });
  expect(state.request).toHaveBeenCalledTimes(1);
  await source.detach();
  expect(state.request).toHaveBeenLastCalledWith(source.write, "host-a");
});
it("rechecks every contributing project before removal and refuses a newly locked contributor", async () => {
  const source = await prepareAssistantSessionDetach(input());
  state.locked.add("/other");
  await expect(source.detach()).rejects.toThrow("original session");
  expect(state.request).toHaveBeenCalledTimes(1);
});
it("never switches the original target after a connection changes during metadata reads", async () => {
  state.owner.session.mockImplementation(async () => {
    state.current = false;
    return { projectId: "project", session: { id: "session", cwd: "/project" } };
  });
  await expect(prepareAssistantSessionDetach(input())).rejects.toThrow("original session");
  expect(state.request).not.toHaveBeenCalled();
});
it("reports a lost acknowledgement without silently replaying the removal", async () => {
  const source = await prepareAssistantSessionDetach(input());
  state.request.mockRejectedValueOnce(new Error("Connection lost after delivery"));
  await expect(source.detach()).rejects.toThrow("Connection lost");
  expect(state.request).toHaveBeenCalledTimes(2);
});
it("uses the actual manual grant version and recognizes an already revoked grant", async () => {
  state.request.mockResolvedValue({
    manual: {
      grants: [
        {
          id: "grant",
          sessionId: "session",
          version: 9,
          active: false,
          source: { projectId: "project" },
        },
      ],
    },
  });
  const source = await prepareAssistantSessionDetach({
    ...input(),
    management: { assistant: true, managedAt: 1, supervisionId: "grant" },
  });
  expect(source.detached).toBe(true);
  expect(source.write).toEqual({
    op: "sessions.detach",
    supervisionId: "grant",
    sessionId: "session",
    expectedVersion: 9,
  });
  expect(state.request).toHaveBeenCalledTimes(1);
});
