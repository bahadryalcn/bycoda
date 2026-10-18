// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ServerRecord } from "../model/serverInventory";
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
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () => root.render(createElement(ServerForwards, { server })));
};
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
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
it("saving metadata never connects and patches only forward rules", async () => {
  await render();
  const inputs = [...container.querySelectorAll("input")];
  await act(async () => {
    for (const [index, value] of [
      [1, "12222"],
      [3, "22"],
    ] as const) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        inputs[index],
        value,
      );
      inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
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
