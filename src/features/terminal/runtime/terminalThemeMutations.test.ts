// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mayChangePalette } from "./terminalTheme";

function record(attributeName: string, oldValue: string | null, current: string) {
  const target = document.createElement("div");
  target.setAttribute("style", current);
  return { attributeName, oldValue, target } as unknown as MutationRecord;
}

it("ignores a panel drag that only resizes an ancestor", () => {
  expect(
    mayChangePalette(
      record(
        "style",
        "grid-template-rows: minmax(0, 1fr) 280px; --tint: red;",
        "grid-template-rows: minmax(0, 1fr) 312px; --tint: red;",
      ),
    ),
  ).toBe(false);
  expect(mayChangePalette(record("style", "", "cursor: row-resize; user-select: none;"))).toBe(
    false,
  );
});

it("re-probes when a color, a custom property or a class changes", () => {
  expect(mayChangePalette(record("style", "height: 10px", "height: 10px; opacity: 0.5"))).toBe(
    true,
  );
  expect(mayChangePalette(record("style", "--tint: red", "--tint: blue"))).toBe(true);
  expect(mayChangePalette(record("class", "dark", ""))).toBe(true);
});
