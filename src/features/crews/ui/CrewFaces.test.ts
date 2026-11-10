// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { CrewAgent, CrewRole } from "../model/crew";
import { CrewFaces } from "./CrewFaces";

const member = (id: string, name: string, role: CrewRole = "specialist"): CrewAgent => ({
  id,
  name,
  role,
  instructions: "",
  selection: "fixed",
  candidates: [],
});

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

async function render(props: Partial<Parameters<typeof CrewFaces>[0]> & { members: CrewAgent[] }) {
  await act(async () => root.render(createElement(CrewFaces, props)));
  return container.querySelector<HTMLElement>('[role="img"]')!;
}

const crew = [
  member("a", "Ayla"),
  member("b", "Ben", "reviewer"),
  member("c", "Cem", "coordinator"),
  member("d", "Deniz"),
];

it("names the crew with the coordinator first, then the reviewer", async () => {
  const wrapper = await render({ members: crew });
  expect(wrapper.getAttribute("aria-label")).toBe("Cem, Ben, Ayla, Deniz");
});

it("uses the given label instead of the member names", async () => {
  const wrapper = await render({ members: crew, label: "Ops crew" });
  expect(wrapper.getAttribute("aria-label")).toBe("Ops crew");
});

it("shows up to max faces and a +N chip for the rest", async () => {
  const wrapper = await render({ members: crew, max: 2 });
  expect(wrapper.querySelectorAll("svg")).toHaveLength(2);
  expect(wrapper.textContent).toBe("+2");
});

it("shows no chip when every member fits", async () => {
  const wrapper = await render({ members: crew, max: 4 });
  expect(wrapper.querySelectorAll("svg")).toHaveLength(4);
  expect(wrapper.textContent).toBe("");
});

it("blinks only the active members", async () => {
  const wrapper = await render({ members: crew, max: 4, activeIds: new Set(["c", "d"]) });
  expect(wrapper.querySelectorAll("style")).toHaveLength(2);
});
