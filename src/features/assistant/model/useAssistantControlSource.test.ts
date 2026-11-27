// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  useAssistantControlSource,
  waitForAssistantControlSource,
} from "./useAssistantControlSource";

const invoke = vi.hoisted(() => vi.fn(async (_command?: string, _payload?: unknown) => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

it("waits for native source ACK and rejects a revoked preconnect source", async () => {
  invoke.mockReset();
  const ack = Promise.withResolvers<undefined>();
  invoke.mockImplementation(async (_command, payload) =>
    (payload as { active: boolean }).active ? ack.promise : undefined,
  );
  const root = createRoot(document.createElement("div"));
  const Surface = () => {
    useAssistantControlSource("room-delayed-preconnect", "host");
    return null;
  };
  await act(async () => root.render(createElement(Surface)));
  let current = true;
  let connected = false;
  const waiting = waitForAssistantControlSource(
    "room-delayed-preconnect",
    "host",
    () => current,
  ).then(() => {
    connected = true;
  });
  const rejected = expect(waiting).rejects.toThrow("source changed");
  await Promise.resolve();
  expect(connected).toBe(false);
  current = false;
  await act(async () => {
    ack.resolve(undefined);
    await Promise.resolve();
  });
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
        {
          threadId: "room",
          environmentId: "host",
          active: false,
          role: "interactive",
          sequence: expect.any(Number),
        },
      ],
      [
        "control_assistant_source_v2",
        {
          threadId: "next",
          environmentId: "host",
          active: true,
          role: "interactive",
          sequence: expect.any(Number),
        },
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
  const Background = () => {
    useAssistantControlSource("room-priority", "host", "background");
    return null;
  };
  const Interactive = () => {
    useAssistantControlSource("room-priority", "host");
    return null;
  };
  const render = (interactive: boolean) =>
    createElement(
      "div",
      {},
      createElement(Background),
      interactive ? createElement(Interactive) : null,
    );
  await act(async () => root.render(render(false)));
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "background" });
  await act(async () => root.render(render(true)));
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "interactive" });
  await act(async () => root.render(render(false)));
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "background" });
  await act(async () => root.unmount());
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: false });
});
it("keeps the background lease alive while a hidden window also holds an interactive source", async () => {
  invoke.mockClear();
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get");
  let hidden = false;
  visibility.mockImplementation(() => (hidden ? "hidden" : "visible"));
  const root = createRoot(document.createElement("div"));
  const Background = () => {
    useAssistantControlSource("room-hidden-owner", "host", "background");
    return null;
  };
  const Voice = () => {
    useAssistantControlSource("room-hidden-owner", "host");
    return null;
  };
  try {
    await act(async () =>
      root.render(createElement("div", {}, createElement(Background), createElement(Voice))),
    );
    expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "interactive" });
    hidden = true;
    const before = invoke.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(invoke.mock.calls.length).toBe(before + 1);
    expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "background" });
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ active: true, role: "interactive" });
    await act(async () => root.unmount());
  } finally {
    visibility.mockRestore();
    vi.useRealTimers();
  }
});
it("fails background registration closed on old native while retaining legacy interactive registration", async () => {
  invoke.mockClear();
  invoke.mockImplementation(async (command) => {
    if (command === "control_assistant_source_v2")
      throw new Error("Command control_assistant_source_v2 not found");
  });
  const root = createRoot(document.createElement("div"));
  const Background = () => {
    useAssistantControlSource("room-old", "host", "background");
    return null;
  };
  const Interactive = () => {
    useAssistantControlSource("room-old", "host");
    return null;
  };
  try {
    await act(async () => root.render(createElement(Background)));
    expect(invoke.mock.calls.some(([command]) => command === "control_assistant_source")).toBe(
      false,
    );
    await act(async () =>
      root.render(createElement("div", {}, createElement(Background), createElement(Interactive))),
    );
    expect(
      invoke.mock.calls.some(
        ([command, payload]) =>
          command === "control_assistant_source" && (payload as { active: boolean }).active,
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  } finally {
    invoke.mockImplementation(async () => undefined);
  }
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

it("does not let a hung Host delay another Room, queue duplicate heartbeats or ping while hidden", async () => {
  invoke.mockReset();
  vi.useFakeTimers();
  const hung = Promise.withResolvers<undefined>();
  invoke.mockImplementation(async (_command, payload) =>
    (payload as { threadId: string }).threadId === "room-hung" ? hung.promise : undefined,
  );
  const root = createRoot(document.createElement("div"));
  const Surface = () => {
    useAssistantControlSource("room-hung", "slow-host");
    useAssistantControlSource("room-healthy", "host");
    return null;
  };
  const calls = (thread: string) =>
    invoke.mock.calls.filter(
      ([, payload]) => (payload as { threadId: string }).threadId === thread,
    );
  let hidden = false;
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockImplementation(() => (hidden ? "hidden" : "visible"));
  try {
    await act(async () => root.render(createElement(Surface)));
    // The healthy Room registered even though the other Host never answered.
    expect(calls("room-healthy")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // Heartbeats while the hung one is still pending are not re-queued.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls("room-healthy")).toHaveLength(2);
    // Hung registration timed out at 10 s; one heartbeat followed, never a growing queue.
    expect(calls("room-hung").length).toBeLessThanOrEqual(2);
    hidden = true;
    const before = invoke.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(invoke.mock.calls.length).toBe(before);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls("room-healthy").at(-1)?.[1]).toMatchObject({ active: true });
    expect(invoke.mock.calls.length).toBeGreaterThan(before);
    await act(async () => root.unmount());
    // Release still revokes both exact sources.
    expect(calls("room-healthy").at(-1)?.[1]).toMatchObject({ active: false });
  } finally {
    visibility.mockRestore();
    vi.useRealTimers();
    hung.resolve(undefined);
    invoke.mockReset();
    invoke.mockImplementation(async () => undefined);
  }
});

it("reports failed native Room registration instead of claiming readiness", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockRejectedValueOnce(new Error("unavailable"));
  const container = document.createElement("div"),
    root = createRoot(container);
  function Surface() {
    const status = useAssistantControlSource("room-failed", "host");
    return createElement("span", null, status);
  }
  try {
    await act(async () => {
      root.render(createElement(Surface));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe("unavailable");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("renews the exact hidden Room while voice is active and stops when voice ends", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const root = createRoot(document.createElement("div"));
  const Surface = ({ active }: { active: boolean }) => {
    useAssistantControlSource("voice-project", "voice-host", "interactive", active);
    return null;
  };
  const calls = () =>
    invoke.mock.calls.filter(
      ([, payload]) => (payload as { threadId: string }).threadId === "voice-project",
    );
  try {
    await act(async () => root.render(createElement(Surface, { active: true })));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(calls()).toHaveLength(5);
    expect(calls().at(-1)?.[1]).toMatchObject({ active: true, role: "interactive" });
    await act(async () => root.render(createElement(Surface, { active: false })));
    const before = calls().length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(calls()).toHaveLength(before);
  } finally {
    await act(async () => root.unmount());
    visibility.mockRestore();
    vi.useRealTimers();
  }
});
