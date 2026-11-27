// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../model/crewClient", () => ({ useProjectCrews: () => state.current }));
import { CrewTaskPicker } from "./CrewTaskPicker";

afterEach(() => vi.unstubAllGlobals());

async function render(props: { value?: string }, onValidityChange = vi.fn()) {
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
        onValidityChange,
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

it("shows the saved crew by name and reports it valid", async () => {
  state.current = crews(true);
  const valid = vi.fn();
  const view = await render({ value: "crew-1" }, valid);
  expect(
    view.container.querySelector("button[aria-haspopup='dialog'][aria-label^='Crew:']")
      ?.textContent,
  ).toContain("Review crew");
  expect(valid).toHaveBeenLastCalledWith(true);
  await view.unmount();
});

it("says so and reports invalid for a saved crew the host cannot run", async () => {
  state.current = crews(false);
  const valid = vi.fn();
  const view = await render({ value: "crew-1" }, valid);
  expect(view.container.textContent).toContain("Connect an updated host");
  expect(valid).toHaveBeenLastCalledWith(false);
  await view.unmount();
});
