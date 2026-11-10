// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCrewMachineScope } from "./CrewMachineScope";

const mocks = vi.hoisted(() => ({
  machine: { id: "local", name: "This computer" },
  request: vi.fn(),
  refetch: vi.fn(),
  remember: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[1] === "machines"
      ? { data: [mocks.machine] }
      : { data: [{ cwd: "G:/Projects/existing" }], refetch: mocks.refetch },
}));
vi.mock("../../automations/public/hostMachines", () => ({
  backgroundMachineFor: () => mocks.machine,
  backgroundMachines: async () => [mocks.machine],
  hostProjectCwd: (_machine: unknown, project: { cwd: string }) => project.cwd,
  machineProjects: async () => [],
  invalidateMachineSnapshot: mocks.invalidate,
}));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../projects/public/projectNames", () => ({
  projectDisplayName: (cwd: string) => cwd.split("/").at(-1),
}));
vi.mock("../../projects/public/recents", () => ({ rememberProject: mocks.remember }));
vi.mock("../model/crewClient", () => ({ useProjectCrews: () => ({}) }));
vi.mock("../model/crewActionError", () => ({ crewMachineLabel: () => "This computer" }));

let root: Root;
let container: HTMLDivElement;
function Harness() {
  const scope = useCrewMachineScope(
    "G:/Projects/existing",
    {} as Parameters<typeof useCrewMachineScope>[1],
  );
  return createElement(
    "div",
    null,
    createElement("output", null, scope.cwd),
    scope.projectPicker(false),
  );
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
const field = () => dialog()!.querySelector<HTMLInputElement>("input")!;
const click = async (item: HTMLElement) => {
  await act(async () => item.click());
};
async function name(value: string) {
  await act(async () => {
    const input = field();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open() {
  await act(async () => root.render(createElement(Harness)));
  await click(container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!);
  await click(button("New project…"));
}
async function submit() {
  await act(async () =>
    dialog()!
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  mocks.refetch.mockResolvedValue({});
  mocks.remember.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens a named creation dialog without replacing the project picker, and cancels cleanly", async () => {
  await open();
  const modal = dialog()!;
  expect(document.getElementById(modal.getAttribute("aria-labelledby")!)?.textContent).toBe(
    "Create project",
  );
  expect(container.querySelector('button[aria-haspopup="dialog"]')?.textContent).toContain(
    "existing",
  );
  expect(modal.textContent).toContain("Created in G:/Projects");
  await name("Draft project");
  await click(button("Cancel"));
  expect(dialog()).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("G:/Projects/existing");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("keeps invalid project names in the dialog without sending a mutation", async () => {
  await open();
  await name("bad/name");
  await submit();
  expect(field().value).toBe("bad/name");
  expect(field().getAttribute("aria-invalid")).toBe("true");
  expect(dialog()!.textContent).toContain(
    "Use a folder name without slashes or special characters.",
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it("retains a failed draft and selects the created project after a successful retry", async () => {
  mocks.request.mockRejectedValueOnce(new Error("Permission denied"));
  await open();
  await name("New project");
  await submit();
  expect(field().value).toBe("New project");
  expect(dialog()!.textContent).toContain("Permission denied");
  expect(container.querySelector("output")?.textContent).toBe("G:/Projects/existing");
  mocks.request
    .mockResolvedValueOnce({ path: "G:/Projects/New project" })
    .mockResolvedValueOnce({ cwd: "G:/Projects/New project" });
  await submit();
  expect(mocks.request).toHaveBeenCalledWith(
    "local",
    "projects.createDirectory",
    {
      path: "G:/Projects",
      name: "New project",
    },
    false,
    true,
  );
  expect(mocks.request).toHaveBeenCalledWith(
    "local",
    "projects.open",
    {
      cwd: "G:/Projects/New project",
    },
    false,
    true,
  );
  expect(dialog()).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("G:/Projects/New project");
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(mocks.invalidate).toHaveBeenCalledWith("local");
  expect(mocks.remember).toHaveBeenCalledWith("G:/Projects/New project");
});
