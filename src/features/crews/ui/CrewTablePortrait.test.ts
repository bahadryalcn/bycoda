// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { CrewAgent, CrewRole } from "../model/crew";
import { CrewTablePortrait } from "./CrewTablePortrait";

const member = (id: string, role: CrewRole = "specialist"): CrewAgent => ({
  id,
  name: id,
  role,
  instructions: "",
  selection: "fixed",
  candidates: [],
});
const crew = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    member(`m${i}`, i === 0 ? "coordinator" : i === 1 ? "reviewer" : "specialist"),
  );

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (
  props: Partial<Parameters<typeof CrewTablePortrait>[0]> & { members: CrewAgent[] },
) =>
  act(async () => {
    root.render(createElement(CrewTablePortrait, { name: "Crew A", ...props }));
  });

it("is one labelled image with decorative members", async () => {
  await render({ members: crew(3), state: "working", stateLabel: "Working" });
  const image = container.querySelector('[role="img"]')!;
  expect(image.getAttribute("aria-label")).toBe("Crew A, 3 members, Working");
  expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
});

it("shows a +N sign beyond six members and none otherwise", async () => {
  await render({ members: crew(9), theme: "classic" });
  expect(container.textContent).toContain("+3");
  await render({ members: crew(6), theme: "classic" });
  expect(container.textContent).not.toContain("+");
});

it("draws a different table per state and theme", async () => {
  const draw = async (state: "idle" | "working" | "blocked", theme: "classic" | "matrix") => {
    await render({ members: crew(3), state, theme });
    return container.querySelector("svg.absolute")!.innerHTML;
  };
  const idle = await draw("idle", "classic");
  expect(await draw("working", "classic")).not.toBe(idle);
  expect(await draw("blocked", "classic")).not.toBe(idle);
  expect(await draw("idle", "matrix")).not.toBe(idle);
});
