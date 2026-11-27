// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SprintProjectRef } from "../model/hostSprints";

vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, footer, title }: any) =>
    createElement("section", { "aria-label": title }, children, footer),
  ModalActions: ({ children }: any) => createElement("div", null, children),
}));
import { SprintEditor } from "./SprintEditor";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const project = {
  environmentId: "local",
  projectId: "project",
  cwd: "/project",
  name: "alpha",
} as SprintProjectRef;
const render = (props: Record<string, unknown> = {}) =>
  act(() =>
    root.render(
      createElement(SprintEditor, {
        projects: [project],
        onClose: () => {},
        onSave: async () => {},
        ...props,
      } as never),
    ),
  );
const submit = () =>
  act(() => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

it("keeps the dialog short: optional dates, closed capacity and no inline sentences", () => {
  render();
  const text = host.textContent ?? "";
  expect(text).toContain("Goal (optional)");
  expect(text).toContain("Dates (optional)");
  expect(text).toContain("Capacity");
  expect(text).toContain("Create sprint");
  expect(text).not.toContain("Dates are optional.");
  // Capacity is a closed disclosure until a capacity exists.
  expect(host.querySelector("details")!.hasAttribute("open")).toBe(false);
});

it("names a missing name and project once, at the field, after the first save attempt", async () => {
  const onSave = vi.fn(async () => {});
  render({ onSave });
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  await submit();
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
  for (const [control, message] of [
    [host.querySelector("input"), "Enter a sprint name."],
    [host.querySelector('button[aria-label^="Projects:"]'), "Choose at least one project."],
  ] as const) {
    expect(control?.getAttribute("aria-invalid")).toBe("true");
    const error = host.querySelector(
      `[role="alert"][id="${control?.getAttribute("aria-describedby")}"]`,
    )!;
    const copy = error.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((entry) => entry.remove());
    expect(copy.textContent).toBe(message);
  }
  expect(onSave).not.toHaveBeenCalled();
});

it("offers Save on only for a new sprint that can choose a server", () => {
  const server = {
    value: "local",
    options: [
      { value: "local", label: "This computer" },
      { value: "mac", label: "Mac" },
    ],
    onChange: vi.fn(),
  };
  render({ server });
  expect(host.textContent).toContain("Save on");
  render({ server, sprint: { id: "s", name: "One", state: "planned", projects: [project] } });
  expect(host.textContent).not.toContain("Save on");
  expect(host.textContent).toContain("Save");
});

it("puts the planning server back when a new sprint dialog is cancelled", async () => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render({
    onClose,
    server: { value: "mac", options: [{ value: "mac", label: "Mac" }], onChange },
  });
  // The caller changed the server while the dialog was open; Cancel restores it.
  render({
    onClose,
    server: { value: "local", options: [{ value: "local", label: "Local" }], onChange },
  });
  const cancel = Array.from(host.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(onChange).toHaveBeenCalledWith("mac");
  expect(onClose).toHaveBeenCalledTimes(1);
});
