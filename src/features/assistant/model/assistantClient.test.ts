// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../connections/model/hostFeatureClient", () => ({
  hostToolRequest: vi.fn(),
}));
vi.mock("./assistantHostRead", () => ({
  captureAssistantHostRead: vi.fn(async () => ({ environmentId: "env" })),
}));
// The real parse always returns a new object; cloning keeps that behavior under test.
vi.mock("../../../shared/model/host-contracts/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/model/host-contracts/assistant")>()),
  AssistantResponseValidationSchema: { parse: (value: unknown) => structuredClone(value) },
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string, params?: Record<string, string>) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => params?.[name] ?? ""),
  useLocale: () => "tr",
}));
import { hostToolRequest } from "../../connections/model/hostFeatureClient";
import {
  assistantRequest,
  possessiveName,
  assistantIdentity,
  refreshAssistant,
  refreshAssistantQuietly,
  useAssistantSnapshot,
  watchAssistantSnapshot,
} from "./assistantClient";

it.each([
  ["Arif", "Arif'in"],
  ["Ayşe", "Ayşe'nin"],
  ["Mert", "Mert'in"],
  ["Umut", "Umut'un"],
  ["Gül", "Gül'ün"],
  ["Ali", "Ali'nin"],
  ["Kai", "Kai'nin"],
  ["Jarvis", "Jarvis'in"],
  ["ALİ", "ALİ'nin"],
])("uses Turkish possessive for %s", (name, expected) => {
  expect(possessiveName(name)).toBe(expected);
});

it("shares one snapshot poll with background watchers and pauses hidden view-only polling", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const root = createRoot(document.createElement("div"));
  function Consumer() {
    useAssistantSnapshot();
    return null;
  }
  const listener = vi.fn();
  let stop: (() => void) | undefined;
  try {
    const request = vi.mocked(hostToolRequest);
    request.mockResolvedValue({ snapshot: { profile: { name: "Initial" } } } as never);
    await act(async () => root.render(createElement(Consumer)));
    const initialReads = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(request).toHaveBeenCalledTimes(initialReads);

    stop = watchAssistantSnapshot(listener);
    request.mockResolvedValue({ snapshot: { profile: { name: "Updated" } } } as never);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(request).toHaveBeenCalledTimes(initialReads + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    stop = undefined;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(request).toHaveBeenCalledTimes(initialReads + 1);
  } finally {
    stop?.();
    await act(async () => root.unmount());
    visibility.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("uses setup navigation until a name exists, and keeps the chosen name unchanged", () => {
  expect(assistantIdentity(undefined, "en")).toMatchObject({
    name: "",
    title: "Set up",
    room: "Set up",
    setupComplete: false,
  });
  const profile = {
    name: "Arif",
    showTitle: true,
    setupComplete: true,
    voiceSetupComplete: false,
  } as any;
  expect(assistantIdentity(profile, "en")).toMatchObject({
    title: "Assistant Arif",
    room: "Room · Arif",
  });
  expect(assistantIdentity({ ...profile, showTitle: false }, "tr")).toMatchObject({
    title: "Arif",
    room: "Arif'in room",
  });
  expect(assistantIdentity({ ...profile, name: "X" }, "tr").room).toBe("Room · X");
});

it("does not re-notify consumers for an unchanged 15 s poll, and notifies once for a changed one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  let renders = 0;
  let latest: { snapshot?: { profile?: { name?: string } } | null; loading?: boolean } | undefined;
  function Consumer() {
    renders++;
    latest = useAssistantSnapshot();
    return null;
  }
  const snapshot = (name: string) => ({ snapshot: { profile: { name } } });
  try {
    vi.mocked(hostToolRequest).mockResolvedValue(snapshot("Arif") as never);
    await act(async () => root.render(createElement(Consumer)));
    await act(() => refreshAssistant());
    expect(latest?.snapshot?.profile?.name).toBe("Arif");
    const rendersAfterLoad = renders;
    const calls = vi.mocked(hostToolRequest).mock.calls.length;

    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(vi.mocked(hostToolRequest).mock.calls.length).toBe(calls + 1);
    expect(renders).toBe(rendersAfterLoad);

    vi.mocked(hostToolRequest).mockResolvedValue(snapshot("Mert") as never);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(renders).toBe(rendersAfterLoad + 1);
    expect(latest?.snapshot?.profile?.name).toBe("Mert");
    expect(latest?.loading).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("selected consumers skip heartbeat-only changes and background refreshes, and the plain form sees every change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  let selectedRenders = 0;
  let plainRenders = 0;
  let selected: string | null | undefined;
  function Selected() {
    selectedRenders++;
    selected = useAssistantSnapshot((state) => state.environmentId);
    return null;
  }
  function Plain() {
    plainRenders++;
    useAssistantSnapshot();
    return null;
  }
  const reply = (heartbeat: number) => ({
    snapshot: { profile: { name: "A" }, lastHeartbeatAt: heartbeat },
  });
  try {
    vi.mocked(hostToolRequest).mockResolvedValue(reply(1) as never);
    await act(async () =>
      root.render(createElement("div", null, createElement(Selected), createElement(Plain))),
    );
    await act(() => refreshAssistant());
    expect(selected).toBe("env");
    const selectedBase = selectedRenders;
    const plainBase = plainRenders;

    await act(() => refreshAssistantQuietly());
    expect(selectedRenders).toBe(selectedBase);
    expect(plainRenders).toBe(plainBase);

    vi.mocked(hostToolRequest).mockResolvedValue(reply(2) as never);
    await act(() => refreshAssistantQuietly());
    expect(selectedRenders).toBe(selectedBase);
    expect(plainRenders).toBe(plainBase + 1);

    const { captureAssistantHostRead } = await import("./assistantHostRead");
    vi.mocked(captureAssistantHostRead).mockResolvedValueOnce({ environmentId: "env-2" } as never);
    await act(() => refreshAssistantQuietly());
    expect(selected).toBe("env-2");
    expect(selectedRenders).toBe(selectedBase + 1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps unchanged snapshot slices by reference and shows only the changed one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  let jobsRenders = 0;
  let jobs: unknown;
  let notes: unknown;
  function Jobs() {
    jobsRenders++;
    jobs = useAssistantSnapshot((state) => state.snapshot?.jobs);
    notes = useAssistantSnapshot((state) => state.snapshot?.notes);
    return null;
  }
  const reply = (state: string) => ({
    snapshot: {
      profile: { name: "A" },
      jobs: [{ id: "j1", state }],
      notes: [{ id: "n1", text: "same" }],
    },
  });
  try {
    vi.mocked(hostToolRequest).mockResolvedValue(reply("running") as never);
    await act(async () => root.render(createElement(Jobs)));
    await act(() => refreshAssistantQuietly());
    const notesBefore = notes;
    const rendersBefore = jobsRenders;

    vi.mocked(hostToolRequest).mockResolvedValue(reply("done") as never);
    await act(() => refreshAssistantQuietly());
    expect(jobs).toEqual([{ id: "j1", state: "done" }]);
    expect(notes).toBe(notesBefore);
    expect(jobsRenders).toBe(rendersBefore + 1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("a mutation refresh reads after an in-flight poll and never flips loading", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const seenLoading: boolean[] = [];
  const seenNames: (string | undefined)[] = [];
  let name: string | undefined;
  function Watcher() {
    const current = useAssistantSnapshot();
    seenLoading.push(current.loading);
    name = current.snapshot?.profile.name;
    seenNames.push(name);
    return null;
  }
  const reply = (name: string) => ({ snapshot: { profile: { name } } });
  try {
    vi.mocked(hostToolRequest).mockResolvedValue(reply("Old") as never);
    await act(async () => root.render(createElement(Watcher)));
    await act(() => refreshAssistant());
    seenLoading.length = 0;

    let release!: (value: unknown) => void;
    vi.mocked(hostToolRequest).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)) as never,
    );
    let poll!: Promise<void>;
    await act(async () => {
      poll = refreshAssistantQuietly();
    });
    vi.mocked(hostToolRequest).mockResolvedValueOnce({ ok: true } as never);
    vi.mocked(hostToolRequest).mockResolvedValue(reply("New") as never);
    const mutation = assistantRequest({ op: "profile.update", name: "New" } as never);
    await act(async () => release(reply("Stale")));
    await act(async () => {
      await poll;
      await mutation;
    });
    expect(seenLoading).not.toContain(true);
    // The pre-mutation poll result is dropped, so the UI never shows it even briefly.
    expect(seenNames).not.toContain("Stale");
    expect(name).toBe("New");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
