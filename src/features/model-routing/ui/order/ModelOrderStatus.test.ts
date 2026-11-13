// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { remoteRequest } from "../../../connections/public/connections";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import { ModelOrderSettings } from "./ModelOrderSettings";
vi.mock("../../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../../tasks/public/hostSettings", async (original) => ({
  ...(await original<typeof import("../../../tasks/public/hostSettings")>()),
  settingsMachines: vi.fn(async () => [{ id: "host", name: "Host" }]),
  listMachineLimits: vi.fn(async () => [
    {
      machineId: "host",
      maxRunningTasks: 2,
      dailyAgentMinutes: 0,
      usedMinutes: 0,
      limitReached: false,
    },
  ]),
  saveMachineLimits: vi.fn(),
}));
vi.mock("../../../sessions/public/modelSource", () => ({
  useModelSource: () => ({ resolve: () => ({ harness: "codex", id: "test" }) }),
}));
vi.mock("../../../sessions/public/ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("../../../sessions/public/ModelLabel", () => ({ ModelLabel: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("shows failed quota refresh beside retained data and retries to valid unknown", async () => {
  let statusCall = 0;
  const state = {
    ...structuredClone(EMPTY_MODEL_ROUTING),
    version: 1,
    updatedAt: 1,
    entries: [{ id: "a", harness: "codex", model: "test", modelSettings: {}, unknownLimit: "use" }],
  };
  vi.mocked(remoteRequest).mockImplementation(async (_id, method) => {
    if (method === "modelRouting.get") return { state };
    if (method === "modelRouting.status") {
      statusCall++;
      if (statusCall === 2) throw new Error("offline");
      return { entries: [statusCall === 1 ? { entryId: "a", leftPercent: 42 } : { entryId: "a" }] };
    }
    throw new Error(`unexpected ${method}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(ModelOrderSettings, { machineId: "host", supported: true }),
        ),
      ),
    );
    await vi.waitFor(() => expect(element.textContent).toContain("42% left"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["models.routing.v1", "host", "status"] });
    });
    await vi.waitFor(() =>
      expect(element.textContent).toContain("Model limits could not be read."),
    );
    expect(element.textContent).toContain("42% left");
    const retry = [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Retry"),
    )!;
    await act(async () => retry.click());
    await vi.waitFor(() => expect(element.textContent).toContain("Limit unknown"));
    expect(element.textContent).not.toContain("Model limits could not be read.");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    element.remove();
  }
});
