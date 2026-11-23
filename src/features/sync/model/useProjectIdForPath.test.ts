// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { hostProjectId } from "./syncProjectId";
import { projectIdForPath, setLocalHostEnvironmentId } from "./syncProjects";
import { useProjectIdForPath } from "./useProjectIdForPath";

it("names local folders by the current host and follows a host change", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const root = createRoot(document.createElement("div"));
  const ids: (string | undefined)[] = [];
  function Probe() {
    ids.push(useProjectIdForPath()("/work/app"));
    return null;
  }
  act(() => setLocalHostEnvironmentId("env-a"));
  act(() => root.render(createElement(Probe)));
  expect(ids.at(-1)).toBe(hostProjectId("env-a", "/work/app"));
  expect(ids.at(-1)).toBe(projectIdForPath("/work/app"));

  act(() => setLocalHostEnvironmentId("env-b"));
  expect(ids.at(-1)).toBe(hostProjectId("env-b", "/work/app"));
  const renders = ids.length;
  act(() => setLocalHostEnvironmentId("env-b"));
  expect(ids).toHaveLength(renders);
  act(() => root.unmount());
});
