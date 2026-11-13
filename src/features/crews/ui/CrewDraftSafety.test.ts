// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewEditorFooter } from "./CrewEditorFooter";
import { CrewWorkOwnerActions, type CrewOwnerTools } from "./CrewWorkOwnerActions";
import type { CrewRunView } from "../model/crewClient";
import { CrewLibraryProfileDialog } from "./CrewLibraryProfileDialog";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import type { SavedCrewAgent } from "../model/crew";

vi.mock("./CrewMemberForm", () => ({
  CrewMemberForm: ({
    agent,
    onChange,
  }: {
    agent: { name: string };
    onChange: (patch: { name: string }) => void;
  }) =>
    createElement("input", {
      value: agent.name,
      onChange: (event: { target: { value: string } }) => onChange({ name: event.target.value }),
    }),
}));

vi.mock("../model/crewComposer", () => ({
  composerCanAssign: () => false,
  composerTitle: (text: string) => text,
}));
vi.mock("../model/crewOwnerActions", () => ({
  noteMembers: () => [{ id: "lead", name: "Lead" }],
  ownerRequestId: (key: string) => key,
  planAssignment: () => ({ ok: false }),
  planNote: (_run: unknown, input: unknown) => ({ ok: true, params: input }),
  retryBlockedTask: vi.fn(),
  retryableTasks: () => [],
  settleOwnerRequest: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it.each(["idle", "saved"] as const)(
  "never announces saved during a revision conflict (%s)",
  (status) => {
    const html = renderToStaticMarkup(
      createElement(CrewEditorFooter, {
        isNew: false,
        issue: "",
        status,
        error: "",
        onRetry: vi.fn(),
        creating: false,
        starting: false,
        pending: false,
        blocked: true,
        canStart: true,
        onCreate: vi.fn(),
        onStart: vi.fn(),
      }),
    );
    expect(html).not.toContain("All changes saved");
    expect(html).toContain("disabled");
  },
);
it.each([false, true])("retires only the submitted owner note, newer edit: %s", async (newer) => {
  let complete!: () => void;
  const call = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () =>
    root.render(
      createElement(CrewWorkOwnerActions, {
        run: { id: "run", status: "active" } as CrewRunView,
        tools: { machineId: "host", tasksSupported: true, call } as CrewOwnerTools,
        memberId: "lead",
        onMemberChange: vi.fn(),
      }),
    ),
  );
  const textarea = container.querySelector("textarea")!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        value,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("Submitted note");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Send")!
      .click(),
  );
  expect(call).toHaveBeenCalledWith(
    "crews.request",
    expect.objectContaining({ note: "Submitted note", memberId: "lead" }),
  );
  if (newer) type("New unsent note");
  await act(async () => complete());
  expect(textarea.value).toBe(newer ? "New unsent note" : "");
  expect(container.textContent?.includes("Note sent to the lead.")).toBe(!newer);
});

it("keeps an edited library profile until explicit discard", async () => {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(CrewLibraryProfileDialog, {
        cwd: "/project",
        state: { call: vi.fn() } as unknown as ReturnType<typeof useProjectCrews>,
        data: {
          machine: { id: "host" },
          project: { id: "project" },
          catalog: {},
        } as unknown as ProjectCrews,
        profile: {
          id: "member",
          name: "Original",
          candidates: [{}],
          updatedAt: 1,
        } as unknown as SavedCrewAgent,
        groupNames: [],
        onClose,
      }),
    ),
  );
  const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "Unsent profile",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")!
      .click(),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Discard changes?");
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent === "Cancel")
      .at(-1)!
      .click(),
  );
  expect(field.value).toBe("Unsent profile");
  expect(onClose).not.toHaveBeenCalled();
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")!
      .click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Discard changes")!
      .click(),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
