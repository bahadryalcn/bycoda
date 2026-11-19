// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { HelperRoleResolution } from "./HelperRoleResolution";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../model/modelRoutingClient", () => ({ resolveModelRouting: mocks.resolve }));
vi.mock("../../../sessions/public/ModelLabel", () => ({
  ModelLabel: ({ model }: { model: string }) => model,
}));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  mocks.resolve.mockReset();
});

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(HelperRoleResolution, {
          machineId: "host",
          role: "text.title",
          choice: { kind: "default" },
          version: 1,
        } as never),
      ),
    ),
  );
  return container;
}

it("says the model could not be checked instead of claiming a fallback when the Host fails", async () => {
  mocks.resolve.mockRejectedValue(new Error("offline"));
  const container = await render();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(container.textContent).toContain("Current model could not be checked");
  expect(container.textContent).not.toContain("own model selection");
});

it("waits past the old 500 ms deadline for a slow remote Host answer", async () => {
  mocks.resolve.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: true, target: { model: "slow-model", harness: "codex" } }),
          800,
        ),
      ),
  );
  const container = await render();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1000)));
  expect(container.textContent).toContain("Now uses");
  expect(container.textContent).toContain("slow-model");
});
