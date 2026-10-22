// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { TAB_GROUP_LOGOS_CHANGED } from "../../workspace/model/tabGroups";

vi.mock("../model/projectLogos", () => ({ projectLogoSrc: (path: string) => path }));
vi.mock("../../workspace/model/tabGroups", () => ({
  TAB_GROUP_LOGOS_CHANGED: "logos-changed",
  tabGroupLogoDisplayRevision: vi.fn().mockReturnValueOnce(0).mockReturnValue(1),
}));

it("shows an accessible fallback for broken images and retries changed assets", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(ProjectLogoIcon, { path: "/broken.png" })));
    act(() => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Project logo could not be loaded",
    );
    expect(container.querySelector("svg")).not.toBeNull();
    act(() => window.dispatchEvent(new Event(TAB_GROUP_LOGOS_CHANGED)));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/broken.png");
    act(() => container.querySelector("img")!.dispatchEvent(new Event("error")));
    act(() => root.render(createElement(ProjectLogoIcon, { path: "/new.png" })));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/new.png");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
