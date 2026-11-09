// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SocialView } from "./SocialView";

// The mount is checked here; the shell's own behavior is covered in shell/SocialShell.test.ts.
vi.mock("./shell/SocialShell", () => ({
  SocialShell: (props: { cwd: string; besideRail?: boolean }) =>
    createElement("section", {
      "data-social-shell": "",
      "data-cwd": props.cwd,
      "data-beside-rail": String(props.besideRail ?? false),
    }),
}));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

it("mounts the redesigned shell and passes the workspace props through", () => {
  act(() =>
    root.render(
      createElement(SocialView, {
        cwd: "/work/brand",
        besideRail: true,
        onClose: () => {},
        header: () => null,
      }),
    ),
  );
  const shell = element.querySelector("[data-social-shell]");
  expect(shell?.getAttribute("data-cwd")).toBe("/work/brand");
  expect(shell?.getAttribute("data-beside-rail")).toBe("true");
});
