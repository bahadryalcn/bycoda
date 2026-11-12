// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewDeleteDialog, StartCrewDialog } from "./CrewDialogs";

vi.mock("./CrewEditor", () => ({ CrewEditDialog: () => null }));
vi.mock("./CrewMachineScope", () => ({
  useCrewMachineScope: (cwd: string, state: unknown) => ({
    cwd,
    state,
    picker: () => null,
    projectPicker: () => null,
  }),
}));
vi.mock("../../sessions/public/AccessPicker", () => ({
  AccessPicker: ({ value, onChange }: { value: string; onChange: (mode: string) => void }) =>
    createElement("button", { "data-access": value, onClick: () => onChange("full-access") }),
}));

type Props = Parameters<typeof StartCrewDialog>[0];
const crew = {
  id: "crew-1",
  name: "Crew",
  updatedAt: 9,
  policy: {},
  agents: [],
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function open(call: ReturnType<typeof vi.fn>, accessSupported = true, project = "p1") {
  const state = {
    data: {
      machine: { id: "m" },
      project: { id: project },
      definitions: [crew],
      accessSupported,
    },
    call,
  } as unknown as Props["state"];
  await act(async () =>
    root.render(createElement(StartCrewDialog, { cwd: "/p", state, onClose: vi.fn() })),
  );
}
const typePrompt = async (text: string) => {
  const area = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (el: Element | null | undefined) => {
  await act(async () => (el as HTMLElement).click());
};
const startButton = () =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Start");

it("saves the crew policy first only when the owner changed the access", async () => {
  const call = vi.fn(async (method: string) => (method === "crews.start" ? { id: "run" } : {}));
  await open(call, true, "p-change");
  await typePrompt("Build it");
  await click(document.querySelector("[data-access]"));
  await click(startButton());
  expect(call.mock.calls.map(([method]) => method)).toEqual(["crews.save", "crews.start"]);
  expect(call.mock.calls[0]![1]).toMatchObject({
    definition: { policy: { runtimeMode: "full-access" } },
    expectedUpdatedAt: 9,
  });
});

it("does not save when access is unchanged or unsupported", async () => {
  const call = vi.fn(async () => ({ id: "run" }));
  await open(call, true, "p-same");
  await typePrompt("Build it");
  await click(startButton());
  expect(call.mock.calls.map(([method]) => method)).toEqual(["crews.start"]);
  call.mockClear();
  await open(call, false, "p-off");
  expect(document.querySelector("[data-access]")).toBeNull();
});

it("a retry after an uncertain start neither saves the policy nor changes the request", async () => {
  let starts = 0;
  const call = vi.fn(async (method: string) => {
    if (method === "crews.start" && ++starts === 1) throw new Error("Connection lost");
    return { id: "run" };
  });
  await open(call, true, "p-retry");
  await typePrompt("Build it");
  await click(document.querySelector("[data-access]"));
  await click(startButton());
  await click(startButton());
  const methods = call.mock.calls.map(([method]) => method);
  expect(methods).toEqual(["crews.save", "crews.start", "crews.start"]);
  const ids = call.mock.calls.filter(([m]) => m === "crews.start").map(([, p]) => p.requestId);
  expect(ids[0]).toBe(ids[1]);
});

it("keeps failed crew deletion open for retry and blocks deletion while work is active", async () => {
  const call = vi.fn().mockRejectedValueOnce(new Error("Host unavailable")).mockResolvedValue({});
  const onClose = vi.fn();
  type DeleteProps = Parameters<typeof CrewDeleteDialog>[0];
  const renderDelete = async (activeWork: number) =>
    act(async () =>
      root.render(
        createElement(CrewDeleteDialog, {
          crew: crew as DeleteProps["crew"],
          state: { call } as unknown as DeleteProps["state"],
          activeWork,
          onClose,
        }),
      ),
    );
  const remove = () =>
    [...document.querySelectorAll<HTMLButtonElement>("footer button")].find(
      (button) => button.textContent === "Delete crew",
    )!;
  await renderDelete(1);
  expect(remove().getAttribute("aria-disabled")).toBe("true");
  await click(remove());
  expect(call).not.toHaveBeenCalled();
  await renderDelete(0);
  await click(remove());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Host unavailable");
  expect(onClose).not.toHaveBeenCalled();
  await click(remove());
  expect(call).toHaveBeenCalledTimes(2);
  expect(call).toHaveBeenLastCalledWith("crews.delete", {
    definitionId: crew.id,
    expectedUpdatedAt: 9,
  });
  expect(onClose).toHaveBeenCalledOnce();
});
