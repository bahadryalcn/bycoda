// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { saveCrewAppearance } from "../model/crewAppearance";
import { CrewAvatar } from "./CrewAvatar";

const seen: { name?: string; color?: string }[] = [];
vi.mock("../../projects/ui/ProjectMascot", () => ({
  ProjectMascot: (props: { name?: string; color?: string }) => {
    seen.push({ name: props.name, color: props.color });
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: ComponentProps<typeof CrewAvatar>) {
  seen.length = 0;
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(CrewAvatar, props)));
  await act(async () => root.unmount());
  return seen.at(-1);
}

beforeEach(() => localStorage.clear());

it("prefers the host look, then the device look, then the hashed default", async () => {
  saveCrewAppearance("c1", { icon: "lab" });
  expect(await render({ crew: { id: "c1", appearance: { icon: "api" } } })).toMatchObject({
    name: "api",
  });
  expect(await render({ crew: { id: "c1" } })).toMatchObject({ name: "lab" });
  expect(await render({ crew: { id: "c2" } })).toMatchObject({ name: undefined });
  expect(
    await render({ crew: { id: "c1", appearance: { icon: "api" } }, look: { icon: "docs" } }),
  ).toMatchObject({ name: "docs" });
});
