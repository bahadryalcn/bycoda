// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession, type Session } from "../../sessions/model/session";
import { loadRemoteCapabilities, loadRemoteSession, remoteRequest } from "./connections";
import { LOCAL_SYNC_MACHINE_NAME } from "./localSync";
import { useAdoptedSessions, type RefreshAdoptedSession } from "./useAdoptedSessions";
import { upsertSession } from "../../sessions/data/sessionStore";
import {
  getComposerDraft,
  setComposerDraft,
  getComposerAttachments,
  setComposerAttachments,
} from "../../sessions/model/draftCache";
import type { HostSession } from "./protocol";
import type { AdoptedEntry } from "./adoptedSessions";
import { bindHarnessSession, isLiveHarness } from "../../../integrations/harness/core/registry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./connections", () => ({
  loadRemoteCapabilities: vi.fn(),
  loadRemoteSession: vi.fn(),
  remoteRequest: vi.fn(),
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  getSession: vi.fn(),
  storedSessionUpdatedAt: vi.fn(),
  upsertSession: vi.fn(),
  upsertSessionIfUnchanged: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  bindHarnessSession: vi.fn(),
  isLiveHarness: vi.fn(() => false),
}));

let root: Root;
let container: HTMLDivElement;
let current: Session;
let entries: AdoptedEntry[];
let refresh: RefreshAdoptedSession;

function Probe({
  initial,
  onLoadRunning,
}: {
  initial: Session;
  onLoadRunning?: (ids: string[]) => void;
}) {
  const [sessions, setSessions] = useState([initial]);
  const ref = useRef(sessions);
  ref.current = sessions;
  const loadRunning = useRef(onLoadRunning);
  const refreshRef = useRef<RefreshAdoptedSession>(undefined);
  useAdoptedSessions(ref, setSessions, loadRunning, refreshRef);
  refresh = (id, target) => refreshRef.current!(id, target);
  current = sessions[0];
  return createElement("span", null, current.continuingElsewhere ? "working" : "idle");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(upsertSession).mockResolvedValue(null as never);
  vi.mocked(isLiveHarness).mockReturnValue(false);
  setComposerDraft("s1", "");
  setComposerAttachments("s1", []);
  vi.mocked(invoke).mockResolvedValue([
    {
      id: "local",
      name: LOCAL_SYNC_MACHINE_NAME,
      endpoint: "http://127.0.0.1:3774",
      environmentId: "env",
    },
  ]);
  vi.mocked(loadRemoteCapabilities).mockResolvedValue(["sessions.desktop"]);
  entries = [{ id: "s1", projectId: "p", revision: 5, updatedAt: 10, status: "running" }];
  vi.mocked(remoteRequest).mockImplementation(async () => entries as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("binds a host provider switch through the incoming adapter even when thread IDs match", async () => {
  vi.mocked(isLiveHarness).mockReturnValue(true);
  const initial = { ...newSession("claude", "/repo"), id: "s1", providerSessionId: "same-thread" };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: {
      ...initial,
      harness: "codex",
      model: "gpt",
      modelSettings: { reasoningEffort: "high" },
    },
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  } as HostSession);
  await act(async () => root.render(createElement(Probe, { initial })));
  expect(current).toMatchObject({
    harness: "codex",
    model: "gpt",
    providerSessionId: "same-thread",
  });
  expect(bindHarnessSession).toHaveBeenCalledExactlyOnceWith(
    "codex",
    "s1",
    "same-thread",
    "/repo",
    undefined,
    [],
  );
});

it("keeps the running indicator and local messages through conflicts, then clears it on finish", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  initial.blocks = [{ id: "u", role: "user", text: "local edit" }];
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: { ...initial, blocks: [] },
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 10,
  } as HostSession);
  await act(async () => root.render(createElement(Probe, { initial })));
  expect(current).toMatchObject({ continuingElsewhere: true, adoptedSyncConflict: true });
  expect(current.blocks).toEqual(initial.blocks);
  expect(current.busy).toBeUndefined();
  expect(container.textContent).toBe("working");

  entries = [{ ...entries[0], status: "idle" }];
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(current.continuingElsewhere).toBeUndefined();
  expect(current.adoptedSyncConflict).toBe(true);
  expect(current.blocks).toEqual(initial.blocks);
  expect(container.textContent).toBe("idle");
});

it("updates running state without a new transcript revision and clears a stale hold on first poll", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1", continuingElsewhere: true };
  entries = [{ ...entries[0], status: "idle" }];
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: initial,
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  } as HostSession);
  await act(async () => root.render(createElement(Probe, { initial })));
  expect(current.continuingElsewhere).toBeUndefined();
  entries = [{ ...entries[0], status: "running" }];
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(current.continuingElsewhere).toBe(true);
  expect(loadRemoteSession).toHaveBeenCalledTimes(1);
  entries = [];
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(current.continuingElsewhere).toBeUndefined();
});

it("hands over host-running sessions that are not loaded here", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  entries = [
    { id: "s1", projectId: "p", revision: 5, updatedAt: 10, status: "running" },
    { id: "s2", projectId: "p", revision: 2, updatedAt: 10, status: "running" },
    { id: "s3", projectId: "p", revision: 2, updatedAt: 10, status: "idle" },
  ];
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: initial,
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 10,
  } as HostSession);
  const onLoadRunning = vi.fn();
  await act(async () => root.render(createElement(Probe, { initial, onLoadRunning })));
  expect(onLoadRunning).toHaveBeenCalledWith(["s2"]);
});

it("preserves a conflict in history, updates the open session, and retains the composer draft and attachments", async () => {
  const initial = {
    ...newSession("claude", "/repo"),
    id: "s1",
    blocks: [{ id: "u", role: "user" as const, text: "local" }],
  };
  const remote = { ...initial, blocks: [{ id: "u", role: "user" as const, text: "host" }] };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: remote,
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 10,
  } as HostSession);
  await act(async () => root.render(createElement(Probe, { initial })));
  vi.mocked(upsertSession)
    .mockClear()
    .mockResolvedValue({ id: "backup" } as never);
  setComposerDraft("s1", "unsent draft");
  const attachments = [
    { name: "draft.png", data: "data:image/png;base64,AA", kind: "image" as const },
  ];
  setComposerAttachments("s1", attachments);
  const added = vi.fn();
  window.addEventListener("bycoda:adopted-session-added", added);
  try {
    await act(async () => expect(await refresh("s1")).toBe(true));
    expect(upsertSession).toHaveBeenCalledOnce();
    expect(vi.mocked(upsertSession).mock.calls[0][0].blocks).toEqual(initial.blocks);
    expect(added).toHaveBeenCalledOnce();
    expect(current.blocks).toEqual(remote.blocks);
    expect(current.continuingElsewhere).toBe(true);
    expect(current.adoptedSyncConflict).toBeUndefined();
    expect(getComposerDraft("s1")).toBe("unsent draft");
    expect(getComposerAttachments("s1")).toEqual(attachments);
  } finally {
    window.removeEventListener("bycoda:adopted-session-added", added);
  }
});

it("automatically retries conflicts, preserves drafts, and backs up once at the same revision", async () => {
  const initial = {
    ...newSession("claude", "/repo"),
    id: "s1",
    blocks: [{ id: "u", role: "user" as const, text: "local" }],
  };
  const remote = { ...initial, blocks: [{ id: "u", role: "user" as const, text: "host" }] };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: remote,
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 10,
  });
  await act(async () => root.render(createElement(Probe, { initial })));
  expect(current.blocks).toEqual(initial.blocks);
  expect(current.adoptedSyncConflict).toBe(true);
  setComposerDraft("s1", "unsent draft");
  const attachments = [{ name: "draft.png", kind: "image" as const, data: "AA" }];
  setComposerAttachments("s1", attachments);
  vi.mocked(upsertSession)
    .mockClear()
    .mockResolvedValue({ id: "backup" } as never);
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(current.blocks).toEqual(remote.blocks);
  expect(current.adoptedSyncConflict).toBeUndefined();
  expect(current.continuingElsewhere).toBe(true);
  expect(upsertSession).toHaveBeenCalledOnce();
  const backup = vi.mocked(upsertSession).mock.calls[0][0];
  expect(backup.blocks).toEqual(initial.blocks);
  expect(backup.id).not.toBe("s1");
  expect(backup.providerSessionId).toBeUndefined();
  expect(backup.queuedMessages).toBeUndefined();
  expect(getComposerDraft("s1")).toBe("unsent draft");
  expect(getComposerAttachments("s1")).toEqual(attachments);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(upsertSession).toHaveBeenCalledOnce();
});

it("queues an explicit refresh behind automatic polling and deduplicates repeated requests", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  const snapshot = {
    session: initial,
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 10,
  } as HostSession;
  let finish!: (host: HostSession) => void;
  vi.mocked(loadRemoteSession)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(snapshot);
  await act(async () => root.render(createElement(Probe, { initial })));
  const first = refresh("s1");
  const second = refresh("s1");
  expect(second).toBe(first);
  expect(loadRemoteSession).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(snapshot);
    await first;
  });
  expect(loadRemoteSession).toHaveBeenCalledTimes(2);
  expect(loadRemoteSession).toHaveBeenLastCalledWith("local", "s1", undefined);
});

it("reports an unavailable host without replacing the local conversation", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: initial,
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  } as HostSession);
  await act(async () => root.render(createElement(Probe, { initial })));
  const previous = current;
  vi.mocked(invoke).mockResolvedValue([]);
  await act(async () => expect(refresh("s1")).rejects.toThrow("Host unavailable"));
  expect(current).toBe(previous);
});

it("follows assistant and tool output after opening a prompt-only local copy", async () => {
  const initial = {
    ...newSession("codex", "/repo"),
    id: "s1",
    blocks: [{ id: "u", role: "user" as const, text: "task" }],
  };
  const blocks = [
    ...initial.blocks,
    { id: "a", role: "assistant" as const, text: "Starting" },
    { id: "t", role: "tool" as const, text: "Tests passed" },
  ];
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: { ...initial, blocks },
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 10,
  });
  await act(async () => root.render(createElement(Probe, { initial })));
  expect(current.blocks).toEqual(blocks);
  expect(current.continuingElsewhere).toBe(true);
  entries = [{ ...entries[0], revision: 6, status: "idle" }];
  const finished = [...blocks, { id: "done", role: "assistant" as const, text: "Finished" }];
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: { ...initial, blocks: finished },
    projectId: "p",
    revision: 6,
    status: "idle",
    updatedAt: 20,
  });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(current.blocks).toEqual(finished);
  expect(current.continuingElsewhere).toBeUndefined();
});

it("validates the task machine and project before an explicit host refresh", async () => {
  const initial = { ...newSession("codex", "/repo"), id: "s1" };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: initial,
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  });
  await act(async () => root.render(createElement(Probe, { initial })));
  const previous = current;
  vi.mocked(loadRemoteSession).mockClear();
  await act(async () =>
    expect(refresh("s1", { sessionId: "s1", machineId: "remote", projectId: "p" })).rejects.toThrow(
      "not on this computer",
    ),
  );
  await act(async () =>
    expect(
      refresh("s1", { sessionId: "s1", machineId: "local", projectId: "other" }),
    ).rejects.toThrow("another project"),
  );
  expect(loadRemoteSession).not.toHaveBeenCalled();
  expect(current).toBe(previous);
});
