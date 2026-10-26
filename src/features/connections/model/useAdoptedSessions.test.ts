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
import { notifyRemoteRecovered } from "./remoteHealth";
import { adoptedBeatFailed, noteAdoptedBeat } from "./hostWake";

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
  refresh = (id, target, resolution) => refreshRef.current!(id, target, resolution);
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

it("preserves the host's dates when automatically adopting old conversation history", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  const old = { ...initial, id: "old", blocks: [{ id: "u", role: "user" as const, text: "old" }] };
  entries = [{ id: "old", projectId: "p", revision: 5, updatedAt: 200, status: "idle" }];
  localStorage.setItem("bycoda.recentProjects", JSON.stringify([{ path: "/repo", openedAt: 1 }]));
  vi.mocked(remoteRequest).mockImplementation(
    async (_machine, method) =>
      (method === "projects.list" ? [{ id: "p", cwd: "/repo", name: "Repo" }] : entries) as never,
  );
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: old,
    projectId: "p",
    revision: 5,
    status: "idle",
    createdAt: 100,
    updatedAt: 200,
  });
  try {
    await act(async () => root.render(createElement(Probe, { initial })));
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "old", cwd: "/repo" }),
      { createdAt: 100, updatedAt: 200 },
    );
  } finally {
    localStorage.removeItem("bycoda.recentProjects");
  }
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

it("keeping both saves one branch in history, updates the open session, and retains the composer draft and attachments", async () => {
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
    await act(async () => expect(await refresh("s1", undefined, "keep-both")).toBe(true));
    expect(upsertSession).toHaveBeenCalledOnce();
    expect(vi.mocked(upsertSession).mock.calls[0][0].blocks).toEqual(initial.blocks);
    expect(vi.mocked(upsertSession).mock.calls[0][0].title).toContain("(branch, ");
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

it("flags a divergence once, keeps the conversation and drafts, and never saves a copy on its own", async () => {
  const initial = {
    ...newSession("claude", "/repo"),
    id: "s1",
    providerSessionId: "local-thread",
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
  const flagged = current.adoptedDivergence;
  expect(flagged?.key).toEqual(expect.any(String));
  setComposerDraft("s1", "unsent draft");
  const attachments = [{ name: "draft.png", kind: "image" as const, data: "AA" }];
  setComposerAttachments("s1", attachments);
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(upsertSession).not.toHaveBeenCalled();
  expect(current.blocks).toEqual(initial.blocks);
  expect(current.providerSessionId).toBe("local-thread");
  expect(current.adoptedSyncConflict).toBe(true);
  expect(current.adoptedDivergence).toBe(flagged);
  expect(current.continuingElsewhere).toBe(true);
  expect(getComposerDraft("s1")).toBe("unsent draft");
  expect(getComposerAttachments("s1")).toEqual(attachments);
});

it("does not flag again a divergence the user already answered, nor save a copy for it", async () => {
  const base = {
    ...newSession("claude", "/repo"),
    id: "s1",
    blocks: [{ id: "u", role: "user" as const, text: "local" }],
  };
  const remote = { ...base, blocks: [{ id: "u", role: "user" as const, text: "host" }] };
  const { adoptedDivergenceKey } = await import("./adoptedSessions");
  const initial = {
    ...base,
    adoptedDivergence: { key: adoptedDivergenceKey(base, remote), keep: true as const },
  };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: remote,
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  });
  await act(async () => root.render(createElement(Probe, { initial })));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(loadRemoteSession).toHaveBeenCalled();
  expect(upsertSession).not.toHaveBeenCalled();
  expect(current.blocks).toEqual(base.blocks);
  expect(current.adoptedSyncConflict).toBeUndefined();
  expect(current.adoptedDivergence).toEqual(initial.adoptedDivergence);
});

it.each(["focus", "online", "visibilitychange", "recovered"])(
  "automatically retries adopted conversations on %s instead of waiting for the poll timer",
  async (event) => {
    const initial = { ...newSession("claude", "/repo"), id: "s1" };
    vi.mocked(remoteRequest).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(loadRemoteSession).mockResolvedValue({
      session: initial,
      projectId: "p",
      revision: 5,
      status: "idle",
      updatedAt: 10,
    });
    await act(async () => root.render(createElement(Probe, { initial })));
    expect(loadRemoteSession).not.toHaveBeenCalled();
    await act(async () => {
      if (event === "recovered") notifyRemoteRecovered("env");
      else if (event === "visibilitychange") document.dispatchEvent(new Event(event));
      else window.dispatchEvent(new Event(event));
    });
    expect(loadRemoteSession).toHaveBeenCalledOnce();
  },
);

it("coalesces recovery events during an in-flight mirror and retries once afterwards", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  let fail!: (reason: unknown) => void;
  vi.mocked(remoteRequest).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: initial,
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  });
  await act(async () => root.render(createElement(Probe, { initial })));
  expect(remoteRequest).toHaveBeenCalledOnce();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    notifyRemoteRecovered("env");
  });
  expect(remoteRequest).toHaveBeenCalledOnce();
  await act(async () => fail(new Error("stale disconnected poll")));
  expect(remoteRequest).toHaveBeenCalledTimes(2);
  expect(loadRemoteSession).toHaveBeenCalledOnce();
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
  // A host without `sessions.digests` is not asked for them.
  expect(loadRemoteSession).toHaveBeenLastCalledWith("local", "s1", undefined, { digests: false });
});

it("asks a host that advertises digests for them, for a refresh and for a new session", async () => {
  vi.mocked(loadRemoteCapabilities).mockResolvedValue(["sessions.desktop", "sessions.digests"]);
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: initial,
    projectId: "p",
    revision: 5,
    status: "idle",
    updatedAt: 10,
  } as HostSession);
  await act(async () => root.render(createElement(Probe, { initial })));
  await act(async () => {
    await refresh("s1");
  });
  expect(loadRemoteSession).toHaveBeenCalled();
  for (const call of vi.mocked(loadRemoteSession).mock.calls)
    expect(call[3]).toEqual({ digests: true });
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

// Step 8: with the host's heartbeat naming what moved, the 5 s / 20 s timer is gone.
const listCalls = () =>
  vi.mocked(remoteRequest).mock.calls.filter(([, method]) => method === "sessions.adopted").length;
function idleHost(initial: Session, revision = 5, blocks = initial.blocks) {
  entries = [{ id: "s1", projectId: "p", revision, updatedAt: 10, status: "idle" }];
  vi.mocked(loadRemoteSession).mockResolvedValue({
    session: { ...initial, blocks },
    projectId: "p",
    revision,
    status: "idle",
    updatedAt: 10,
  } as HostSession);
}

it("polls only once a minute while the host heartbeat reports changes", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  idleHost(initial);
  await act(async () => root.render(createElement(Probe, { initial })));
  // Until the host has said anything, the old cadence still applies.
  await act(async () => noteAdoptedBeat({ ids: [], reset: true }));
  const before = listCalls();
  await act(async () => vi.advanceTimersByTimeAsync(55_000));
  // The old timer ran eleven passes in these 55 seconds.
  expect(listCalls()).toBe(before);
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(listCalls()).toBe(before + 1);
  // The heartbeat answering with nothing new starts no pass.
  await act(async () => noteAdoptedBeat({ ids: [], reset: false }));
  expect(listCalls()).toBe(before + 1);
});

it("shows a change the host reports within one beat, without any timer", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  idleHost(initial);
  await act(async () => root.render(createElement(Probe, { initial })));
  await act(async () => noteAdoptedBeat({ ids: [], reset: true }));
  expect(current.blocks).toHaveLength(0);
  idleHost(initial, 6, [{ id: "reply", role: "assistant", text: "from the other computer" }]);
  await act(async () => noteAdoptedBeat({ ids: ["s1"], reset: false }));
  expect(current.blocks.map((block) => block.id)).toEqual(["reply"]);
});

it("still delivers a reported change to a hidden window", async () => {
  const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    const initial = { ...newSession("claude", "/repo"), id: "s1" };
    idleHost(initial);
    await act(async () => root.render(createElement(Probe, { initial })));
    await act(async () => noteAdoptedBeat({ ids: [], reset: true }));
    const before = listCalls();
    await act(async () => vi.advanceTimersByTimeAsync(50_000));
    expect(listCalls()).toBe(before);
    idleHost(initial, 6, [{ id: "reply", role: "assistant", text: "while hidden" }]);
    await act(async () => noteAdoptedBeat({ ids: ["s1"], reset: false }));
    expect(current.blocks.map((block) => block.id)).toEqual(["reply"]);
  } finally {
    hidden.mockRestore();
  }
});

it("falls back to its own cadence, with no tight loop, when the heartbeat stops or the host is down", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  idleHost(initial);
  await act(async () => root.render(createElement(Probe, { initial })));
  await act(async () => noteAdoptedBeat({ ids: [], reset: true }));
  vi.mocked(remoteRequest).mockRejectedValue(new Error("offline"));
  const before = listCalls();
  // The heartbeat failing is told to the mirror once; it looks at the host itself.
  await act(async () => adoptedBeatFailed());
  await act(async () => adoptedBeatFailed());
  expect(listCalls()).toBe(before + 1);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  // One look every 5 s while unreachable, as before: never a retry loop.
  expect(listCalls() - before).toBeLessThanOrEqual(13);
  expect(listCalls() - before).toBeGreaterThanOrEqual(10);
});

it("retries a conversation it could not mirror with growing delays, not every few seconds", async () => {
  const initial = { ...newSession("claude", "/repo"), id: "s1" };
  idleHost(initial);
  // A conversation from a project this desktop never opened stays the host's alone.
  entries = [
    ...entries,
    { id: "s2", projectId: "elsewhere", revision: 2, updatedAt: 10, status: "idle" },
  ];
  await act(async () => root.render(createElement(Probe, { initial })));
  await act(async () => noteAdoptedBeat({ ids: [], reset: true }));
  const before = listCalls();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  // 5 s, 10 s, 20 s, 40 s...: three looks where the old timer made twelve.
  expect(listCalls() - before).toBeGreaterThanOrEqual(2);
  expect(listCalls() - before).toBeLessThanOrEqual(4);
});
