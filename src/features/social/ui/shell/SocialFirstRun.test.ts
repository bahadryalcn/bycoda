// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SocialFirstRun } from "./SocialFirstRun";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { clients, openSettings } = vi.hoisted(() => ({
  clients: new Map<string, ReturnType<typeof fakeClient>>(),
  openSettings: vi.fn(),
}));
vi.mock("../../../decision-models", async () => ({
  DecisionModelsFirstRunCard: (
    await import("../../../decision-models/ui/DecisionModelsFirstRunCard")
  ).DecisionModelsFirstRunCard,
  decisionModelsClient: (id: string) => clients.get(id),
  openDecisionModelsSettings: openSettings,
}));
function fakeClient() {
  let dismissed = false;
  return {
    firstRun: {
      get: vi.fn(async () => ({ dismissed })),
      set: vi.fn(async (next: { dismissed: boolean }) => {
        dismissed = next.dismissed;
        return next;
      }),
    },
    sources: { list: vi.fn(async () => ({ sources: [] as unknown[] })) },
    local: { recommend: vi.fn(async () => ({ tier: "strong" })) },
  };
}
const KEY = "bycoda.social.decisionFirstRunDismissed";
let element: HTMLDivElement, root: Root;
let queryClient: QueryClient;
async function render(machineId = "m1") {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SocialFirstRun, { machineId }),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const button = (label: string) =>
  [...element.querySelectorAll("button")].find((node) => node.textContent === label);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.clear();
  clients.set("m1", fakeClient());
  clients.set("m2", fakeClient());
  openSettings.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  element.remove();
  vi.unstubAllGlobals();
});

it("Set up dismisses immediately and stays dismissed without saving settings", async () => {
  await render();
  await act(async () => button("Set up")!.click());
  expect(openSettings).toHaveBeenCalledOnce();
  expect(element.textContent).toBe("");
  expect(clients.get("m1")!.firstRun.set).toHaveBeenCalledWith({ dismissed: true });
  act(() => root.unmount());
  root = createRoot(element);
  await render();
  expect(element.textContent).toBe("");
});
it("Not now persists only on the selected Host", async () => {
  await render();
  await act(async () => button("Not now")!.click());
  await render("m2");
  expect(button("Set up")).toBeDefined();
  expect(clients.get("m2")!.firstRun.set).not.toHaveBeenCalled();
});
it("stays hidden without a Host and while its state loads", async () => {
  await render("");
  expect(element.textContent).toBe("");
  clients.get("m1")!.firstRun.get.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(element.textContent).toBe("");
});
it("hides an already configured Host", async () => {
  clients.get("m1")!.sources.list.mockResolvedValue({ sources: [{ id: "configured" }] });
  await render();
  expect(element.textContent).toBe("");
});

it("keeps optional setup hidden for malformed responses instead of rejecting an unobserved promise", async () => {
  clients.get("m1")!.firstRun.get.mockResolvedValue(null as never);
  await render();
  expect(element.textContent).toBe("");
});
it("keeps dismissal in this session if persistence fails", async () => {
  clients.get("m1")!.firstRun.set.mockRejectedValue(new Error("offline"));
  await render();
  await act(async () => button("Set up")!.click());
  expect(element.textContent).toBe("");
  await render("m2");
  await render("m1");
  expect(element.textContent).toBe("");
});
it("consumes the legacy global dismissal once, never writing it to another Host", async () => {
  localStorage.setItem(KEY, "1");
  await render();
  expect(element.textContent).toBe("");
  expect(clients.get("m1")!.firstRun.set).toHaveBeenCalledWith({ dismissed: true });
  await render("m2");
  expect(button("Set up")).toBeDefined();
  expect(clients.get("m2")!.firstRun.set).not.toHaveBeenCalled();
});
it("ignores delayed state from the previous Host", async () => {
  let resolve!: (value: { dismissed: boolean }) => void;
  clients.get("m1")!.firstRun.get.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await render("m2");
  expect(button("Set up")).toBeDefined();
  await act(async () => resolve({ dismissed: true }));
  expect(button("Set up")).toBeDefined();
  expect(clients.get("m2")!.firstRun.set).not.toHaveBeenCalled();
});
