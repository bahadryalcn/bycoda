import { defaultCrewPolicy } from "../model/crew";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewDeleteDialog, StartCrewDialog } from "./CrewDialogs";
import { saveTask } from "../../tasks/model/taskClient";
import type { TaskDraft } from "../../tasks/model/taskClient";
const { form } = vi.hoisted(() => ({
  form: {} as {
    draft: TaskDraft;
    onChange: (draft: TaskDraft) => void;
    onSubmit: (mode: string, draft: TaskDraft) => Promise<void>;
  },
}));
vi.mock("../../tasks/ui/TaskForm", () => ({
  TaskForm: (props: typeof form) => {
    Object.assign(form, props);
    return null;
  },
}));
vi.mock("../../connections/public/HostModelSource", () => ({
  HostModelSource: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../tasks/model/taskClient", () => ({
  newTaskDraft: (cwd: string, harness: string, model: string) => ({
    cwd,
    harness,
    model,
    title: "",
    prompt: "",
    creation: { id: crypto.randomUUID() },
    modelSettings: {},
    runtimeMode: "auto",
    review: false,
    autoMerge: false,
    continueUntilDone: true,
    verifyCommand: "",
  }),
  saveTask: vi.fn(async () => ({ id: "task", workspaceControlsSupported: false })),
  startTask: vi.fn(),
}));

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
  policy: structuredClone(defaultCrewPolicy),
  agents: [],
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(saveTask).mockClear();
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
    refetch: vi.fn(),
  } as unknown as Props["state"];
  await act(async () =>
    root.render(createElement(StartCrewDialog, { cwd: "/p", state, onClose: vi.fn() })),
  );
}
const click = async (el: Element | null | undefined) => {
  await act(async () => (el as HTMLElement).click());
};
it("preselects the exact crew and machine in the canonical task form", async () => {
  await open(vi.fn(), true, "task-target");
  expect(form.draft).toMatchObject({
    cwd: "/p",
    machineId: "m",
    crewDefinitionId: "crew-1",
    runtimeMode: "supervised",
  });
  await act(async () => form.onSubmit("todo", form.draft));
  expect(saveTask).toHaveBeenCalledWith([expect.objectContaining({ id: "m" })], form.draft, "todo");
});

it("retains a dismissed task draft and its original creation receipt", async () => {
  await open(vi.fn(), true, "task-retained");
  const next = { ...form.draft, title: "Build it", prompt: "Keep this work" };
  await act(async () => form.onChange(next));
  await act(async () => root.render(null));
  await open(vi.fn(), true, "task-retained");
  expect(form.draft).toBe(next);
});

it("an uncertain task save keeps the same draft and never calls crews.start", async () => {
  const call = vi.fn();
  vi.mocked(saveTask).mockRejectedValueOnce(new Error("Connection lost"));
  await open(call, true, "task-receipt");
  const draft = form.draft;
  await act(async () => form.onSubmit("queued", draft));
  expect(form.draft).toBe(draft);
  await act(async () => form.onSubmit("queued", draft));
  expect(vi.mocked(saveTask).mock.calls.at(-1)?.[1]).toBe(draft);
  expect(call).not.toHaveBeenCalled();
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
