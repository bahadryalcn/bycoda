// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SshRunbookQueue } from "./SshRunbookQueue";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  list: vi.fn(),
  dismiss: vi.fn(),
  refresh: vi.fn(),
  queue: { intents: [] as any[], error: "" },
  rendered: undefined as any,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("../model/sshRunbookQueue", () => ({
  refreshSshRunbookQueue: native.refresh,
  useSshRunbookQueue: () => native.queue,
}));
vi.mock("../model/sshRunbooks", () => ({
  listSshRunbooks: native.list,
  dismissSshRunbookIntent: native.dismiss,
}));
vi.mock("./SshRunbooks", () => ({
  SshRunbooks: (props: any) => {
    native.rendered = props;
    return createElement("div", { "data-testid": "runbook-review" }, props.intentId ?? props.runId);
  },
}));
const intent = {
  id: "intent",
  automationId: "book",
  revision: 4,
  trigger: "scheduled",
  createdAt: 1,
  status: "pendingReview",
};
const server = {
  id: "server",
  name: "Saved server",
  kind: "ssh",
  sshEndpoint: { host: "remote.invalid", port: 22 },
  metadata: { tags: [], favorite: false },
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.queue = { intents: [intent], error: "" };
  native.rendered = undefined;
  native.list.mockResolvedValue([{ id: "book", revision: 4, targetIds: [server.id] }]);
  native.invoke.mockResolvedValue([server]);
  native.dismiss.mockResolvedValue(undefined);
  native.refresh.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name)!;
async function open() {
  await act(async () => root.render(createElement(SshRunbookQueue)));
  await act(async () => button("SSH reviews · 1").click());
}
it("shows pending reviews without lookup or execution on mount, and dismisses metadata explicitly", async () => {
  await open();
  expect(document.body.textContent).toContain("book · r4");
  expect(native.invoke).not.toHaveBeenCalled();
  expect(native.list).not.toHaveBeenCalled();
  expect(native.rendered).toBeUndefined();
  await act(async () => button("Dismiss").click());
  expect(native.dismiss).toHaveBeenCalledExactlyOnceWith("intent");
  expect(native.refresh).toHaveBeenCalledOnce();
  expect(native.rendered).toBeUndefined();
});
it("refuses a changed native runbook revision before opening the execution surface", async () => {
  native.list.mockResolvedValue([{ id: "book", revision: 5, targetIds: [server.id] }]);
  await open();
  await act(async () => button("Review execution").click());
  expect(document.body.textContent).toContain("Runbook changed. Refresh and review again.");
  expect(native.rendered).toBeUndefined();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("server_inventory_list");
});
it("passes exact intent authority, preserves last run identity after closing, and never starts through the queue", async () => {
  await open();
  await act(async () => button("Review execution").click());
  expect(native.rendered).toMatchObject({
    server,
    servers: [server],
    initialAutomationId: "book",
    intentId: "intent",
    runId: undefined,
  });
  await act(async () => native.rendered.onRun("ambiguous-run-id"));
  expect(native.rendered.runId).toBe("ambiguous-run-id");
  expect(native.rendered.intentId).toBeUndefined();
  await act(async () => native.rendered.onClose());
  await act(async () => button("Last execution").click());
  expect(native.rendered.runId).toBe("ambiguous-run-id");
  expect(native.rendered.intentId).toBeUndefined();
  expect(native.invoke.mock.calls.every(([command]) => command === "server_inventory_list")).toBe(
    true,
  );
  await act(async () => native.rendered.onAbandon());
  expect(native.rendered.runId).toBeUndefined();
  expect(native.rendered.intentId).toBe("intent");
});
it("opens an explicitly requested empty startup queue and can be reopened without execution", async () => {
  native.queue = { intents: [], error: "" };
  await act(async () => root.render(createElement(SshRunbookQueue, { openRequest: 0 })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.render(createElement(SshRunbookQueue, { openRequest: 1 })));
  expect(document.body.textContent).toContain("No pending SSH reviews.");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  await act(async () => root.render(createElement(SshRunbookQueue, { openRequest: 2 })));
  expect(document.body.textContent).toContain("No pending SSH reviews.");
  expect(native.invoke).not.toHaveBeenCalled();
  expect(native.list).not.toHaveBeenCalled();
});
it("retains the visible native intent and error message when dismiss fails", async () => {
  native.dismiss.mockRejectedValueOnce(new Error("not dismissed"));
  await open();
  await act(async () => button("Dismiss").click());
  expect(document.body.textContent).toContain("Error: not dismissed");
  expect(document.body.textContent).toContain("book · r4");
  expect(native.refresh).not.toHaveBeenCalled();
});
it("synchronously prevents duplicate review lookup before a pending render", async () => {
  let answer: (value: any) => void = () => {};
  native.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await open();
  await act(async () => {
    button("Review execution").click();
    button("Review execution").click();
  });
  expect(native.invoke).toHaveBeenCalledOnce();
  expect(native.list).toHaveBeenCalledOnce();
  await act(async () => answer([server]));
  expect(native.rendered.intentId).toBe("intent");
});
