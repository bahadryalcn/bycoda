// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolInspectionPanel, inspectionJson } from "./ToolInspectionPanel";
import type { Block } from "../model/session";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("recognizes only complete saved JSON collections", () => {
  expect(inspectionJson(' {"result": [1, 2]} ')).toEqual({ data: { result: [1, 2] } });
  expect(inspectionJson('[{"ok":true}]')).toEqual({ data: [{ ok: true }] });
  for (const text of ['{"result":', 'log: {"ok":true}', "null", "42", "<script>alert(1)</script>"])
    expect(inspectionJson(text)).toBeNull();
});

it("renders JSON output as a tree while truncated output and commands retain their exact text", async () => {
  const text = '{"result":{"ok":true}}';
  const block: Block = {
    id: "tool",
    role: "tool",
    text: "Inspect result",
    tool: { output: text, status: "completed" },
  };
  await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
  expect(container.querySelector('[role="tree"]')).not.toBeNull();
  await act(async () =>
    root.render(
      createElement(ToolInspectionPanel, {
        block: { ...block, tool: { ...block.tool, outputTruncated: true } },
      }),
    ),
  );
  expect(container.querySelector('[role="tree"]')).toBeNull();
  expect(container.querySelector("pre")?.textContent).toBe(text);
  await act(async () =>
    root.render(
      createElement(ToolInspectionPanel, {
        block: { ...block, tool: { preview: { kind: "shell", title: text } } },
      }),
    ),
  );
  expect(container.querySelector('[role="tree"]')).toBeNull();
  expect(container.querySelector("pre")?.textContent).toBe(text);
});
