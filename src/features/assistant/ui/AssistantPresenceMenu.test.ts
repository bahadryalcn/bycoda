// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantPresenceMenu } from "./AssistantPresenceMenu";
import type { AssistantPresenceView, AssistantPresencePort } from "../model/assistantPresence";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ready: AssistantPresenceView = {
  revision: 1,
  sourceToken: "host-a",
  status: { state: "present", setupComplete: true, assistantName: "Arif" },
  pending: false,
  statusError: false,
  writeError: false,
  retry: null,
};
let root: ReturnType<typeof createRoot>,
  container: HTMLDivElement,
  port: AssistantPresencePort,
  receive: (view: AssistantPresenceView) => void;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  port = {
    read: vi.fn(async () => ready),
    refresh: vi.fn(async () => ready),
    set: vi.fn(async () => ({
      ...ready,
      revision: 2,
      status: { ...ready.status!, state: "away" },
    })),
    subscribe: async (callback) => {
      receive = callback;
      return () => {};
    },
  };
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(createElement(AssistantPresenceMenu, { port })));
}
async function open() {
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
}
function choice(label: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"],[role="menuitem"]'),
  ].find((button) => button.getAttribute("aria-label") === label)!;
}
it("shares exact original native menu source and renders actual locked-away ACK", async () => {
  await render();
  await open();
  expect(choice("Here").getAttribute("aria-checked")).toBe("true");
  await act(async () => choice("Here").click());
  expect(port.set).toHaveBeenCalledWith("host-a", "present");
  expect(container.textContent).toContain("Away");
});
it("disables stale open menu after selected Host changes instead of adopting its token", async () => {
  await render();
  await open();
  await act(() => receive({ ...ready, revision: 2, sourceToken: "host-b" }));
  expect(choice("Away").disabled).toBe(true);
  await act(() => choice("Away").click());
  expect(port.set).not.toHaveBeenCalled();
});
it("allows manual availability while the computer reads Away without claiming Here from its ACK", async () => {
  const away: AssistantPresenceView = {
    ...ready,
    status: { ...ready.status!, state: "away" },
  };
  vi.mocked(port.read).mockResolvedValue(away);
  vi.mocked(port.refresh).mockResolvedValue(away);
  vi.mocked(port.set).mockResolvedValue({ ...away, revision: 2 });
  await render();
  await open();
  expect(container.textContent).toContain("Away");
  expect(choice("Here").disabled).toBe(false);
  expect(choice("Refresh").disabled).toBe(false);
  await act(async () => choice("Here").click());
  expect(port.set).toHaveBeenCalledWith("host-a", "present");
  expect(container.textContent).toContain("Away");
});
it("retains failed exact choice and source for Retry and prevents changing intent", async () => {
  const failed: AssistantPresenceView = {
    ...ready,
    revision: 3,
    statusError: true,
    writeError: true,
    retry: "away",
  };
  vi.mocked(port.set)
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce({ ...ready, revision: 4, status: { ...ready.status!, state: "away" } });
  await render();
  await open();
  await act(async () => choice("Away").click());
  expect(document.body.textContent).toContain("Availability change was not confirmed.");
  expect(choice("Do not disturb").disabled).toBe(true);
  await act(async () => choice("Retry").click());
  expect(port.set).toHaveBeenNthCalledWith(2, "host-a", "away");
  expect(container.textContent).toContain("Away");
});
it("keeps late native reads from overwriting a newer event and never changes presence on mount", async () => {
  let resolve!: (view: AssistantPresenceView) => void;
  vi.mocked(port.read).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () =>
    receive({ ...ready, revision: 7, status: { ...ready.status!, state: "dnd" } }),
  );
  await act(async () => {
    resolve(ready);
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Do not disturb");
  expect(port.set).not.toHaveBeenCalled();
});
it("hides unconfigured identity rather than claiming an assistant is ready", async () => {
  vi.mocked(port.read).mockResolvedValue({
    ...ready,
    status: { state: "away", setupComplete: false },
  });
  await render();
  expect(container.querySelector("button")).toBeNull();
});

it.each([
  ["present", "success"],
  ["away", "warning"],
  ["idle", "warning"],
  ["dnd", "danger"],
] as const)("colors actual native %s without writing presence", async (state, tone) => {
  vi.mocked(port.read).mockResolvedValue({ ...ready, status: { ...ready.status!, state } });
  await render();
  expect(container.querySelector("[data-presence-state]")?.getAttribute("data-presence-tone")).toBe(
    tone,
  );
  expect(port.set).not.toHaveBeenCalled();
});
it("keeps the last confirmed state while a choice is in flight until actual ACK and preserves its exact source", async () => {
  let resolve!: (view: AssistantPresenceView) => void;
  vi.mocked(port.set).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await open();
  await act(async () => choice("Away").click());
  expect(
    container.querySelector("[data-presence-state]")?.getAttribute("data-presence-state"),
  ).toBe("present");
  expect(container.textContent).toContain("Updating availability...");
  await act(async () => {
    resolve({ ...ready, revision: 2, status: { ...ready.status!, state: "away" } });
  });
  expect(port.set).toHaveBeenCalledWith("host-a", "away");
  expect(container.querySelector("[data-presence-state]")?.getAttribute("data-presence-tone")).toBe(
    "warning",
  );
});
it("shows Offline when the native status was never read", async () => {
  vi.mocked(port.read).mockRejectedValue(new Error("offline"));
  await render();
  const mark = container.querySelector("[data-presence-state]");
  expect(mark?.getAttribute("data-presence-state")).toBe("offline");
  expect(mark?.getAttribute("data-presence-tone")).toBe("neutral");
  expect(container.textContent).toContain("Offline");
  expect(container.textContent).not.toContain("Unknown");
  expect(port.set).not.toHaveBeenCalled();
});
it("shows Offline for a null status", async () => {
  vi.mocked(port.read).mockResolvedValue({ ...ready, status: null });
  await render();
  expect(
    container.querySelector("[data-presence-state]")?.getAttribute("data-presence-state"),
  ).toBe("offline");
  expect(container.textContent).toContain("Offline");
});
it("keeps the last confirmed Here when a later read fails", async () => {
  await render();
  expect(container.textContent).toContain("Here");
  await act(async () => receive({ ...ready, revision: 2, statusError: true }));
  const mark = container.querySelector("[data-presence-state]");
  expect(mark?.getAttribute("data-presence-state")).toBe("present");
  expect(container.textContent).toContain("Here");
  expect(container.textContent).not.toContain("Unknown");
  expect(container.textContent).not.toContain("Offline");
});
