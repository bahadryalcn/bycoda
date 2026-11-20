// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiffCommentComposer } from "./DiffCommentComposer";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("names the comment textarea for assistive technology", async () => {
  await act(async () =>
    root.render(
      createElement(DiffCommentComposer, {
        path: "src/app.ts",
        target: {
          line: { kind: "add", text: "const a = 1;", oldNumber: null, newNumber: 12 },
          anchor: { x: 0, y: 0 },
        },
        onDismiss: vi.fn(),
      }),
    ),
  );
  const textarea = document.querySelector("textarea")!;
  expect(textarea.getAttribute("aria-label")).toBe("Comment");
  expect(textarea.getAttribute("placeholder")).toBe("Leave a comment…");
});
