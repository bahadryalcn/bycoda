// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostSession,
  RemoteMachine,
} from "../../connections/model/protocol";
import { saveHostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import type { Session } from "./session";
import type { LocalSessionLocator } from "./localSessionReference";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRequest: vi.fn(),
  nativeSessionReference: vi.fn(),
  resolveNativeSessionReference: vi.fn(),
  locked: false,
  privacy: { lock: {} } as { lock: object },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: mocks.remoteRequest,
}));
vi.mock("../../group-lock/model/groupLock", () => ({
  getGroupLockView: () => mocks.privacy,
}));
vi.mock("../../group-lock/model/lockState", () => ({
  isProjectLockedIn: () => mocks.locked,
}));
vi.mock("./nativeSessionReference", () => ({
  nativeSessionReference: mocks.nativeSessionReference,
  resolveNativeSessionReference: mocks.resolveNativeSessionReference,
}));
import {
  localReferenceForSession,
  resolveLocalSessionReference,
} from "./localSessionNavigation";

const native: LocalSessionLocator = {
  kind: "native",
  sourceStoreId: "store",
  sourceProfileId: "profile",
  sessionId: "same-id",
};
const host: LocalSessionLocator = {
  kind: "host",
  environmentId: "local-origin",
  sessionId: "same-id",
};
const machine = {
  id: "local-machine",
  name: "This computer (local sync)",
  endpoint: "http://127.0.0.1:52111",
  environmentId: "local-origin",
  localHost: true,
} as RemoteMachine;
const project = { id: "project", name: "Project", cwd: "/project" };
const snapshot = {
  session: { id: "same-id", title: "Current title", blocks: [] },
  projectId: "project",
  revision: 7,
  status: "idle",
  archived: true,
} as HostSession;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.locked = false;
  mocks.privacy = { lock: {} };
  mocks.invoke.mockResolvedValue(machine);
  mocks.nativeSessionReference.mockResolvedValue(native);
  mocks.resolveNativeSessionReference.mockResolvedValue({
    locator: native,
    title: "Native title",
    cwd: "/project",
    archived: true,
    updatedAt: 1,
  });
  mocks.remoteRequest.mockImplementation(async (_machine, method) =>
    method === "projects.list" ? [project] : snapshot,
  );
});

describe("local session owner resolution", () => {
  it("resolves Native with full persisted origin, retaining archive state without Host or write calls", async () => {
    const target = await resolveLocalSessionReference({ locator: native });
    expect(target).toMatchObject({
      locator: native,
      archived: true,
      cwd: "/project",
    });
    expect(mocks.resolveNativeSessionReference).toHaveBeenCalledExactlyOnceWith(
      native,
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });

  it("rejects a foreign Native origin without retrying the same session id against Host", async () => {
    mocks.resolveNativeSessionReference.mockResolvedValue(null);
    await expect(
      resolveLocalSessionReference({ locator: native }),
    ).rejects.toThrow("unavailable");
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });

  it("rejects another environment or a nonlocal endpoint before Host reads", async () => {
    for (const foreign of [
      { ...machine, environmentId: "other" },
      { ...machine, endpoint: "https://example.test" },
      { ...machine, ssh: {} },
    ]) {
      mocks.invoke.mockResolvedValue(foreign);
      await expect(
        resolveLocalSessionReference({ locator: host }),
      ).rejects.toThrow("another local Host");
    }
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });

  it("uses authenticated local Host reads and verifies the returned project and exact id", async () => {
    const target = await resolveLocalSessionReference({ locator: host });
    expect(target).toMatchObject({
      locator: host,
      title: "Current title",
      archived: true,
    });
    expect(mocks.remoteRequest).toHaveBeenCalledWith(
      "local-machine",
      "sessions.get",
      { sessionId: "same-id", preview: true, summary: true },
      false,
      true,
      "local-origin",
    );
    mocks.remoteRequest.mockImplementation(async (_machine, method) =>
      method === "projects.list"
        ? [project]
        : { ...snapshot, session: { ...snapshot.session, id: "wrong-id" } },
    );
    await expect(
      resolveLocalSessionReference({ locator: host }),
    ).rejects.toThrow("unavailable");
    mocks.remoteRequest.mockImplementation(async (_machine, method) =>
      method === "projects.list" ? [] : snapshot,
    );
    await expect(
      resolveLocalSessionReference({ locator: host }),
    ).rejects.toThrow("unavailable");
  });

  it("rejects metadata when privacy changes in flight and while the project is locked", async () => {
    mocks.resolveNativeSessionReference.mockImplementationOnce(async () => {
      mocks.privacy = { lock: {} };
      return {
        locator: native,
        title: "Hidden",
        cwd: "/project",
        archived: false,
      };
    });
    await expect(
      resolveLocalSessionReference({ locator: native }),
    ).rejects.toThrow("unavailable");
    mocks.locked = true;
    await expect(
      resolveLocalSessionReference({ locator: host }),
    ).rejects.toThrow("unavailable");
  });

  it("follows only the Native resolver's proven Host mapping, preserving exact environment identity", async () => {
    mocks.resolveNativeSessionReference.mockResolvedValue({
      locator: host,
      title: "Old title",
      cwd: "/project",
      archived: true,
    });
    const target = await resolveLocalSessionReference({ locator: native });
    expect(target.locator).toEqual(host);
    expect(target.title).toBe("Current title");
  });

  it("copies the saved Host binding instead of a renderer shell id or stale inline binding", async () => {
    const binding = {
      kind: "local-host" as const,
      machineId: "local-machine",
      environmentId: "local-origin",
      projectId: "project",
      sessionId: "same-id",
      authorityGeneration: null,
      created: true,
    };
    const shell = saveHostSessionBinding(
      {
        id: "display-shell",
        cwd: "/project",
        title: "Display",
        blocks: [],
      } as unknown as Session,
      binding,
    );
    expect(
      await localReferenceForSession({
        ...shell,
        hostBinding: { ...binding, sessionId: "stale-inline" },
      }),
    ).toEqual(host);
    expect(mocks.nativeSessionReference).not.toHaveBeenCalled();
  });

  it("does not mint a link for an unsaved Host shell or missing Native row", async () => {
    const binding = {
      kind: "local-host" as const,
      machineId: "local-machine",
      environmentId: "local-origin",
      projectId: "project",
      sessionId: "same-id",
      authorityGeneration: null,
      created: false,
    };
    await expect(
      localReferenceForSession({ id: "draft-shell", hostBinding: binding }),
    ).rejects.toThrow("Save");
    mocks.nativeSessionReference.mockResolvedValue(null);
    await expect(
      localReferenceForSession({ id: "draft-native" }),
    ).rejects.toThrow("unavailable");
  });
});
