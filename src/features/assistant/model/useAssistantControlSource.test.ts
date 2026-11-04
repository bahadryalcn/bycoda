// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAssistantControlSource, waitForAssistantControlSource } from "./useAssistantControlSource";

const invoke = vi.hoisted(() => vi.fn(async (_command?: string, _payload?: unknown) => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

it("waits for native source ACK and rejects a revoked preconnect source", async () => {
  invoke.mockReset();
  const ack = Promise.withResolvers<undefined>();
  invoke.mockImplementation(async (_command, payload) => (payload as { active: boolean }).active ? ack.promise : undefined);
  const root = createRoot(document.createElement("div"));
  const Surface = () => { useAssistantControlSource("room-delayed-preconnect", "host"); return null; };
  await act(async () => root.render(createElement(Surface)));
  let current = true;
  let connected = false;
  const waiting = waitForAssistantControlSource("room-delayed-preconnect", "host", () => current)
    .then(() => { connected = true; });
  const rejected = expect(waiting).rejects.toThrow("source changed");
  await Promise.resolve();
  expect(connected).toBe(false);
  current = false;
  await act(async () => { ack.resolve(undefined); await Promise.resolve(); });
  await rejected;
  expect(connected).toBe(false);
  await act(async () => root.unmount());
  invoke.mockReset();
});

it("serializes Room registration, heartbeat and exact-source revocation across thread changes", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div"),
    root = createRoot(container);
  const Surface = ({ thread, host }: { thread?: string; host?: string }) => {
    useAssistantControlSource(thread, host);
    return null;
  };
  try {
    await act(async () => root.render(createElement(Surface, {})));
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Surface, { thread: "room", host: "host" })));
    expect(invoke).toHaveBeenLastCalledWith("control_assistant_source_v2", {
      threadId: "room",
      environmentId: "host",
      active: true,
      role: "interactive",
      sequence: expect.any(Number),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => root.render(createElement(Surface, { thread: "next", host: "host" })));
    expect(invoke.mock.calls.slice(-2)).toEqual([
      [
        "control_assistant_source_v2",
        { threadId: "room", environmentId: "host", active: false, role: "interactive", sequence: expect.any(Number) },
      ],
      [
        "control_assistant_source_v2",
        { threadId: "next", environmentId: "host", active: true, role: "interactive", sequence: expect.any(Number) },
      ],
    ]);
    await act(async () => root.unmount());
    expect(invoke).toHaveBeenLastCalledWith("control_assistant_source_v2", {
      threadId: "next",
      environmentId: "host",
      active: false,
      role: "interactive",
      sequence: expect.any(Number),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(invoke).toHaveBeenCalledTimes(5);
  } finally {
    vi.useRealTimers();
  }
});

it("shares a source across Room and voice until both release it", async () => {
  invoke.mockClear();
  const root = createRoot(document.createElement("div"));
  const Consumer = () => {
    useAssistantControlSource("room-shared", "host");
    return null;
  };
  const Surface = ({ voice }: { voice: boolean }) =>
    createElement(
      "div",
      {},
      createElement(Consumer, { key: "room" }),
      voice ? createElement(Consumer, { key: "voice" }) : null,
    );
  await act(async () => root.render(createElement(Surface, { voice: true })));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => root.render(createElement(Surface, { voice: false })));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  expect(invoke).toHaveBeenLastCalledWith("control_assistant_source_v2", {
    threadId: "room-shared",
    environmentId: "host",
    active: false,
    role: "interactive",
    sequence: expect.any(Number),
  });
});
it("upgrades a shared background source for an interactive Room and downgrades on close", async () => {
  invoke.mockClear();
  const root = createRoot(document.createElement("div"));
  const Background = () => { useAssistantControlSource("room-priority", "host", "background"); return null; };
  const Interactive = () => { useAssistantControlSource("room-priority", "host"); return null; };
  const render = (interactive: boolean) => createElement("div", {}, createElement(Background), interactive ? createElement(Interactive) : null);
  await act(async () => root.render(render(false)));
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "background" });
  await act(async () => root.render(render(true)));
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "interactive" });
  await act(async () => root.render(render(false)));
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "background" });
  await act(async () => root.unmount());
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: false });
});
it("fails background registration closed on old native while retaining legacy interactive registration", async () => {
  invoke.mockClear();
  invoke.mockImplementation(async command => { if (command === "control_assistant_source_v2") throw new Error("Command control_assistant_source_v2 not found"); });
  const root = createRoot(document.createElement("div"));
  const Background = () => { useAssistantControlSource("room-old", "host", "background"); return null; };
  const Interactive = () => { useAssistantControlSource("room-old", "host"); return null; };
  try {
    await act(async () => root.render(createElement(Background)));
    expect(invoke.mock.calls.some(([command]) => command === "control_assistant_source")).toBe(false);
    await act(async () => root.render(createElement("div", {}, createElement(Background), createElement(Interactive))));
    expect(invoke.mock.calls.some(([command, payload]) => command === "control_assistant_source" && (payload as { active: boolean }).active)).toBe(true);
    await act(async () => root.unmount());
  } finally { invoke.mockImplementation(async () => undefined); }
});

it("orders same-source StrictMode remounts and timed-out native replies with increasing fences", async () => {
  invoke.mockClear();
  vi.useFakeTimers();
  let finishOld!: () => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishOld = resolve;
      }),
  );
  const root = createRoot(document.createElement("div"));
  const Consumer = () => {
    useAssistantControlSource("room-reused", "host");
    return null;
  };
  try {
    await act(async () => root.render(createElement(Consumer)));
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => root.render(createElement(StrictMode, {}, createElement(Consumer))));
    const beforeLate = invoke.mock.calls.map(
      (call) => call[1] as { sequence: number; active: boolean },
    );
    expect(beforeLate[0].active).toBe(true);
    expect(beforeLate[1].active).toBe(false);
    expect(beforeLate.at(-1)?.active).toBe(true);
    for (let index = 1; index < beforeLate.length; index++)
      expect(beforeLate[index].sequence).toBeGreaterThan(beforeLate[index - 1].sequence);
    await act(async () => {
      finishOld();
    });
    expect(invoke).toHaveBeenCalledTimes(beforeLate.length);
    await act(async () => root.unmount());
    const newest = invoke.mock.calls.at(-1)![1] as { sequence: number; active: boolean };
    expect(newest.active).toBe(false);
    expect(newest.sequence).toBeGreaterThan(beforeLate.at(-1)!.sequence);
  } finally {
    vi.useRealTimers();
  }
});

it("reports failed native Room registration instead of claiming readiness", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockRejectedValueOnce(new Error("unavailable"));
  const container=document.createElement("div"),root=createRoot(container);
  function Surface() { const status=useAssistantControlSource("room-failed","host"); return createElement("span",null,status); }
  try {
    await act(async()=>{root.render(createElement(Surface)); await new Promise(resolve=>setTimeout(resolve,0));});
    expect(container.textContent).toBe("unavailable");
  } finally { await act(async()=>root.unmount()); vi.unstubAllGlobals(); }
});
