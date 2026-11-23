// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { projectIdForPath, setLocalHostEnvironmentId } from "../model/syncProjects";
import { useProjectIdForPath } from "./useProjectIdForPath";

const PATH = "/work/clinic";
let root: Root;
let rendered: string | undefined;

function Probe() {
  rendered = useProjectIdForPath()(PATH);
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

it("renders the host-based id as soon as the local host becomes known", () => {
  act(() => root.render(createElement(Probe)));
  const machineBased = rendered;
  expect(machineBased).toBe(projectIdForPath(PATH));

  act(() => setLocalHostEnvironmentId("environment-1"));

  expect(rendered).toBe(projectIdForPath(PATH));
  expect(rendered).not.toBe(machineBased);
});
