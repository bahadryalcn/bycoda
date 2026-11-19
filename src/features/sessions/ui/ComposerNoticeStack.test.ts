// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ComposerNoticeStack } from "./ComposerNoticeStack";

it("caps stacked notices and scrolls them without unmounting any", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        ComposerNoticeStack,
        null,
        createElement("div", { role: "alert", key: "a" }, "one"),
        createElement("div", { role: "status", key: "b" }, "two"),
      ),
    ),
  );
  const stack = container.querySelector<HTMLElement>("[data-composer-notices]");
  expect(stack?.className).toContain("max-h-[max(4rem,min(40cqb,14rem))]");
  expect(stack?.className).toContain("overflow-y-auto");
  expect(stack?.querySelectorAll("[role=alert], [role=status]")).toHaveLength(2);
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
