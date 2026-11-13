// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../model/crewClient", () => ({ useProjectCrews: () => state.current }));
import { CrewTaskPicker } from "./CrewTaskPicker";

afterEach(() => vi.unstubAllGlobals());

async function render(props: { value?: string }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(CrewTaskPicker, {
        cwd: "C:/project",
        machineId: "host",
        onChange: () => {},
        onValidityChange: () => {},
        ...props,
      }),
    ),
  );
  return { container, unmount: () => act(async () => root.unmount()) };
}

const crews = (taskExecutionSupported: boolean) => ({
  data: {
    machine: { id: "host" },
    taskExecutionSupported,
    definitions: [{ id: "crew-1", name: "Review crew" }],
  },
  error: null,
  isFetching: false,
  refetch: vi.fn(),
});

it("collapses to one quiet line with an info control when the host has no Crews support", async () => {
  state.current = crews(false);
  const view = await render({});
  expect(view.container.querySelector("[data-crew-task-unsupported]")).not.toBeNull();
  expect(view.container.textContent).toContain("Runs as a single agent");
  expect(view.container.querySelector("button[aria-label='Crews unavailable']")).not.toBeNull();
  expect(view.container.querySelector("[role='alert']")).toBeNull();
  expect(
    view.container.querySelector("button[aria-haspopup='dialog'][aria-label^='Worker:']"),
  ).toBeNull();
  await view.unmount();
});

it("keeps the crew picker when the host supports Crews", async () => {
  state.current = crews(true);
  const view = await render({});
  expect(view.container.querySelector("[data-crew-task-unsupported]")).toBeNull();
  expect(
    view.container.querySelector("button[aria-haspopup='dialog'][aria-label^='Worker:']"),
  ).not.toBeNull();
  expect(view.container.textContent).toContain("Agent");
  await view.unmount();
});

it("keeps the picker and the alert for a saved crew the host cannot run", async () => {
  state.current = crews(false);
  const view = await render({ value: "crew-1" });
  expect(view.container.querySelector("[data-crew-task-unsupported]")).toBeNull();
  expect(view.container.textContent).toContain("Connect an updated host");
  await view.unmount();
});
