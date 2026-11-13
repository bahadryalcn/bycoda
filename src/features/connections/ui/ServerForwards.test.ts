// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ServerRecord } from "../model/serverInventory";
const events = vi.hoisted(() => ({
  callback: null as null | ((event: { payload: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("../../../platform/tauri/listenWindow", () => ({
  listenWindow: (_name: string, callback: typeof events.callback) => {
    events.callback = callback;
    return () => {
      if (events.callback === callback) events.callback = null;
    };
  },
}));
const approval = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./useSshHttpProxyApproval", () => ({
  useSshHttpProxyApproval: () => ({ request: approval.request, dialog: null }),
}));
const mocks = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn(), stop: vi.fn(), save: vi.fn() }));
vi.mock("../model/serverInventory", () => ({ updateServerMetadata: mocks.save }));
vi.mock("../model/sshForwards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/sshForwards")>()),
  listSshForwards: mocks.list,
  startSshForward: mocks.start,
  stopSshForward: mocks.stop,
}));
import { ServerForwards } from "./ServerForwards";
let root: Root;
let container: HTMLDivElement;
const rule = {
  id: "r1",
  name: "Database",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
};
const server: ServerRecord = {
  id: "s1",
  name: "Fixture",
  kind: "ssh",
  metadata: { tags: ["preserve"], favorite: true, forwards: [rule] },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  resetRetainedState();
  mocks.list.mockResolvedValue([]);
  mocks.start.mockResolvedValue({});
  mocks.stop.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(document, "hidden");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([false, true])(
  "clears recovered poll errors while retaining unrelated action failures (action=%s)",
  async (actionFailure) => {
    vi.useFakeTimers();
    mocks.list.mockRejectedValueOnce(new Error("Status read unavailable"));
    await render();
    expect(container.textContent).toContain("Couldn’t read forwarding status.");
    expect(container.textContent).toContain("Status unknown");
    expect(container.textContent).not.toContain("Stopped");
    if (actionFailure) {
      await click("Retry");
      mocks.start.mockRejectedValueOnce(new Error("SSH start failed"));
      await click("Start");
      expect(container.textContent).toContain("SSH start failed");
      mocks.list.mockRejectedValueOnce(new Error("Status read unavailable again"));
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(container.textContent).toContain("Couldn’t read forwarding status.");
      expect(container.textContent).toContain("SSH start failed");
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
      expect(
        [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry"),
      ).toBeDefined();
    }
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(container.textContent).not.toContain("Couldn’t read forwarding status.");
    if (actionFailure) expect(container.textContent).toContain("SSH start failed");
    else expect(container.querySelector('[role="alert"]')).toBeNull();
  },
);

it("does not claim a stopped forward or allow Start before the first status response", async () => {
  mocks.list.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(container.textContent).toContain("Status unknown");
  expect(container.textContent).not.toContain("Stopped");
  expect(
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Start"),
  ).toBeUndefined();
  expect(mocks.start).not.toHaveBeenCalled();
});
const render = async () => {
  await act(async () => root.render(createElement(ServerForwards, { server })));
};
const click = async (label: string) => {
  const button =
    [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label)) ??
    [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((item) =>
      item.closest("label")?.textContent?.includes(label),
    );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
};
const setInput = async (label: string, value: string) => {
  const input = [...container.querySelectorAll("input")].find(
    (item) =>
      item.closest("label")?.textContent?.includes(label) ||
      (item.id && container.querySelector(`label[for="${item.id}"]`)?.textContent?.includes(label)),
  )!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
it("mount and restore read status without starting any saved rule", async () => {
  await render();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(container.textContent).toContain("127.0.0.1:15432");
  await act(async () => root.render(null));
  await render();
  expect(mocks.start).not.toHaveBeenCalled();
  await click("Start");
  expect(mocks.start).toHaveBeenCalledWith("s1", rule);
});
it("running rule stops explicitly and cannot be removed while active", async () => {
  mocks.list.mockResolvedValue([{ id: "s1:r1", connectionId: "s1", state: "running" }]);
  await render();
  const remove = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "Remove",
  )!;
  expect(remove.disabled).toBe(true);
  await click("Stop");
  expect(mocks.stop).toHaveBeenCalledWith("s1:r1");
  expect(mocks.start).not.toHaveBeenCalled();
});

it("keeps a stopping forward fenced and offers a stop retry for an unknown outcome", async () => {
  mocks.list.mockResolvedValue([{ id: "s1:r1", connectionId: "s1", state: "stopping" }]);
  await render();
  expect(container.textContent).toContain("Stopping");
  const stopping = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Stopping"),
  );
  expect(stopping?.disabled).toBe(true);
  expect(
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Remove")
      ?.disabled,
  ).toBe(true);
  await act(async () => root.render(null));
  mocks.list.mockResolvedValue([
    { id: "s1:r1", connectionId: "s1", state: "unknown", error: "Stop not confirmed" },
  ]);
  await render();
  expect(container.textContent).toContain("Status unknown");
  expect(container.textContent).toContain("Stop not confirmed");
  await click("Retry stop");
  expect(mocks.stop).toHaveBeenCalledWith("s1:r1");
  expect(mocks.start).not.toHaveBeenCalled();
});
it("saving metadata never connects and patches only forward rules", async () => {
  await render();
  await setInput("Local port", "12222");
  await setInput("Destination port", "22");
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(mocks.save).toHaveBeenCalledWith("s1", {
    forwards: [
      rule,
      expect.objectContaining({ localPort: 12222, targetHost: "127.0.0.1", targetPort: 22 }),
    ],
  });
  expect(mocks.start).not.toHaveBeenCalled();
});
it("keeps the local destination draft through SOCKS5 mode changes and saves without connecting", async () => {
  await render();
  await setInput("Destination host", "database.internal");
  await setInput("Destination port", "5432");
  await setInput("Local port", "1080");
  await click("SOCKS5");
  expect(container.textContent).toContain("SOCKS5 · 127.0.0.1:1080");
  expect(container.textContent).not.toContain("Destination host");
  await click("Local");
  expect(
    [...container.querySelectorAll("input")].some((input) => input.value === "database.internal"),
  ).toBe(true);
  expect([...container.querySelectorAll("input")].some((input) => input.value === "5432")).toBe(
    true,
  );
  await click("SOCKS5");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mocks.save).toHaveBeenCalledWith("s1", {
    forwards: [
      rule,
      expect.objectContaining({ kind: "dynamic", localPort: 1080, targetHost: "", targetPort: 0 }),
    ],
  });
  expect(mocks.start).not.toHaveBeenCalled();
  await click("Local");
  expect(
    [...container.querySelectorAll("input")].some((input) => input.value === "database.internal"),
  ).toBe(true);
});
it("restores saved SOCKS5 rules without autostart and starts only by explicit action", async () => {
  const proxy = {
    id: "proxy",
    kind: "dynamic" as const,
    name: "Proxy",
    localPort: 1080,
    targetHost: "",
    targetPort: 0,
  };
  const saved = { ...server, metadata: { ...server.metadata, forwards: [proxy] } };
  await act(async () => root.render(createElement(ServerForwards, { server: saved })));
  expect(container.textContent).toContain("SOCKS5 · 127.0.0.1:1080");
  expect(mocks.start).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(ServerForwards, { server: saved })));
  expect(mocks.start).not.toHaveBeenCalled();
  await click("Start");
  expect(mocks.start).toHaveBeenCalledWith("s1", proxy);
});

it("reviews the effective proxy route once for explicit forward start and never authenticates on mount/stop", async () => {
  const endpoint = {
    host: "effective.invalid",
    port: 2222,
    httpProxy: { host: "proxy.invalid", port: 3128 },
  };
  const target = {
    ...server,
    sshEndpoint: { host: "base.invalid", port: 22 },
    effectiveSshEndpoint: endpoint,
  };
  approval.request.mockResolvedValueOnce(null).mockResolvedValue("forward-ticket");
  await act(async () => root.render(createElement(ServerForwards, { server: target })));
  expect(approval.request).not.toHaveBeenCalled();
  await click("Start");
  expect(mocks.start).not.toHaveBeenCalled();
  await click("Start");
  expect(approval.request).toHaveBeenLastCalledWith({
    connectionId: server.id,
    endpoint,
    operation: {
      kind: "forward",
      id: "s1:r1",
      forwardKind: "local",
      localPort: 15432,
      targetHost: "127.0.0.1",
      targetPort: 5432,
    },
  });
  expect(mocks.start).toHaveBeenCalledExactlyOnceWith("s1", rule, "forward-ticket");
  mocks.list.mockResolvedValue([{ id: "s1:r1", connectionId: "s1", state: "running" }]);
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(ServerForwards, { server: target })));
  await click("Stop");
  expect(approval.request).toHaveBeenCalledTimes(2);
  expect(mocks.stop).toHaveBeenCalledWith("s1:r1");
});

it("refreshes only matching native source events, with visible bounded fallback", async () => {
  vi.useFakeTimers();
  await render();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  const emit = async (connectionId: string, machine = "local") =>
    act(async () => {
      events.callback?.({
        payload: { machine, connectionId, forwardId: "r1", generation: "g1", revision: 1 },
      });
    });
  await emit("other");
  await emit("s1", "remote");
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await emit("s1");
  expect(mocks.list).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
  });
  await emit("s1");
  expect(mocks.list).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.list).toHaveBeenCalledTimes(3);
});

it("discards a late status result after switching the selected profile", async () => {
  let resolve!: (value: unknown[]) => void;
  mocks.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () =>
    root.render(createElement(ServerForwards, { server: { ...server, id: "s2" } })),
  );
  await act(async () => resolve([{ id: "s1:r1", connectionId: "s1", state: "running" }]));
  expect(container.textContent).not.toContain("Running");
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("coalesces events while a read is pending and rejects its stale result", async () => {
  let resolve!: (value: unknown[]) => void;
  mocks.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => {
    events.callback?.({
      payload: {
        machine: "local",
        connectionId: "s1",
        forwardId: "s1:r1",
        generation: "old",
        revision: 1,
      },
    });
    events.callback?.({
      payload: {
        machine: "local",
        connectionId: "s1",
        forwardId: "s1:r1",
        generation: "new",
        revision: 2,
      },
    });
  });
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => resolve([{ id: "s1:r1", connectionId: "s1", state: "running" }]));
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("Running");
});
