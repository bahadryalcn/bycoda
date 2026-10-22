// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  remote: vi.fn(),
  catalog: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/model/hostFeatureClient", () => ({ hostFeatureRequest: mock.remote }));
vi.mock("../../../integrations/harness/providers/generic-acp/genericAcpAdapter", () => ({
  refreshGenericAcpCatalog: mock.catalog,
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  probeHarnessAvailability: mock.probe,
}));
import { GenericAcpSettings } from "./GenericAcpSettings";

const config = {
  id: "test-agent",
  name: "Test agent",
  command: "C:/agent.exe",
  args: ["--acp"],
  envKeys: ["API_KEY"],
  authMethodId: "browser",
  contextWindow: 32000,
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mock.invoke.mockResolvedValue([config]);
  mock.remote.mockResolvedValue([config]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(cwd = "C:/project") {
  await act(async () => root.render(createElement(GenericAcpSettings, { cwd })));
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
}

it("keeps every advanced value when editing and saves on the selected host without overwriting stored environment", async () => {
  const cwd = "remote://host-one/project";
  await render(cwd);
  expect(container.textContent).toContain("remote host host-one");
  act(() => button("Edit").click());
  expect(
    container.querySelector("#acp-agent-form-disclosure section")?.getAttribute("aria-labelledby"),
  ).toBeTruthy();
  expect([...container.querySelectorAll("input")].map((input) => input.value)).toEqual([
    config.id,
    config.name,
    config.command,
    "",
    "browser",
    "32000",
  ]);
  expect(container.querySelector("textarea")?.value).toBe('["--acp"]');
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const { envKeys: _keys, ...saved } = config;
  expect(mock.remote).toHaveBeenCalledWith(cwd, "generic-acp-v1", "generic_acp_save", {
    config: saved,
  });
  expect(mock.invoke).not.toHaveBeenCalled();
  expect(mock.catalog).not.toHaveBeenCalled();
  expect(mock.probe).not.toHaveBeenCalled();
  expect(container.textContent).toContain("ACP agent saved on the target machine.");
  expect(container.querySelector("input")?.value).toBe("");
});

it("retains the form after a failed save and allows retry", async () => {
  await render();
  act(() => button("Edit").click());
  mock.invoke.mockImplementation(async (command) => {
    if (command === "generic_acp_save") throw new Error("Host save failed");
    return [config];
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host save failed");
  expect(
    container.querySelector("#acp-agent-form-disclosure section")?.getAttribute("aria-labelledby"),
  ).toBeTruthy();
  expect(container.querySelector("input")?.value).toBe(config.id);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(container.textContent).not.toContain("ACP agent saved on the target machine.");
  mock.invoke.mockResolvedValue([config]);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.textContent).toContain("ACP agent saved on the target machine.");
  expect(container.querySelector("input")?.value).toBe("");
});

it("focuses the visible agent form from the Add agent action", async () => {
  await render();
  act(() => button("Add agent").click());
  expect(document.activeElement).toBe(container.querySelector("input"));
});

it("does not show an empty list before loading finishes or replace a new machine's list with a late response", async () => {
  let resolveOld!: (value: (typeof config)[]) => void;
  mock.remote.mockImplementation((cwd) =>
    cwd.includes("old-host")
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve([]),
  );
  await render("remote://old-host/project");
  expect(container.textContent).toContain("Loading ACP agents…");
  expect(button("Save agent").disabled).toBe(true);
  await render("remote://new-host/project");
  await act(async () => resolveOld([config]));
  expect(container.textContent).toContain("remote host new-host");
  expect(container.textContent).toContain("No ACP agents configured");
  expect(container.textContent).not.toContain(config.name);
});
