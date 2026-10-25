// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolInspectionPanel, inspectionJson } from "./ToolInspectionPanel";
import type { Block } from "../model/session";
const clipboard = vi.hoisted(() => ({ copy: vi.fn(async (_text: string) => {}) }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyMessage: clipboard.copy }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  clipboard.copy.mockReset().mockResolvedValue(undefined);
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

it("keeps copy feedback local, blocks duplicates and permits retry after a failure", async () => {
  let reject!: (error: Error) => void;
  clipboard.copy.mockReturnValueOnce(
    new Promise<void>((_resolve, failure) => {
      reject = failure;
    }),
  );
  const block: Block = {
    id: "copy",
    role: "tool",
    text: "Result",
    tool: { output: "saved output", status: "completed" },
  };
  await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
  const button = container.querySelector("button")!;
  button.focus();
  act(() => {
    button.click();
    button.click();
  });
  expect(clipboard.copy).toHaveBeenCalledExactlyOnceWith("saved output");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(button);
  await act(async () => reject(new Error("Clipboard denied")));
  expect(container.textContent).toContain("Copy failed");
  expect(button.hasAttribute("aria-busy")).toBe(false);
  await act(async () => button.click());
  expect(clipboard.copy).toHaveBeenCalledTimes(2);
  expect(button.textContent).toContain("Copied");
});

it("does not show an old copy result on a different tool output", async () => {
  let resolve!: () => void;
  clipboard.copy.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const block: Block = {
    id: "first",
    role: "tool",
    text: "Result",
    tool: { output: "first output", status: "completed" },
  };
  await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
  act(() => container.querySelector("button")!.click());
  await act(async () =>
    root.render(
      createElement(ToolInspectionPanel, {
        block: { ...block, id: "second", tool: { output: "second output", status: "completed" } },
      }),
    ),
  );
  await act(async () => resolve());
  expect(container.querySelector("button")!.textContent).toBe("Copy");
  await act(async () => container.querySelector("button")!.click());
  expect(clipboard.copy).toHaveBeenLastCalledWith("second output");
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
