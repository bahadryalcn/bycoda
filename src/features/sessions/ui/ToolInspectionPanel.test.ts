// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  approvalHasInspection,
  ToolInspectionPanel,
  inspectionJson,
  hasToolInspection,
  jsonNodeCount,
  toolCallArguments,
} from "./ToolInspectionPanel";
import type { Block } from "../model/session";
const clipboard = vi.hoisted(() => ({ copy: vi.fn(async (_text: string) => {}) }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyMessage: clipboard.copy }));

let container: HTMLDivElement;
let root: Root;
function diffBlock(text: string): Block {
  return {
    id: "diff",
    role: "tool",
    text: "Edit",
    tool: { preview: { kind: "write", inspection: { kind: "diff", text } } },
  };
}

it("keeps selected diff text exact and groups equal tones without CSS Highlights", async () => {
  vi.stubGlobal("Highlight", undefined);
  const text = "+one\r\n+two\r\n context\n-del\n-again";
  await act(async () =>
    root.render(createElement(ToolInspectionPanel, { block: diffBlock(text) })),
  );
  const pre = container.querySelector("pre")!;
  expect(pre.textContent).toBe(text);
  expect(pre.querySelectorAll("span")).toHaveLength(3);
  expect(pre.querySelector('[data-tone="added"]')?.textContent).toBe("+one\r\n+two\r\n");
  expect(pre.querySelector('[data-tone="removed"]')?.textContent).toBe("-del\n-again");
});

it("paints alternating lines on one text node and removes only a closing panel's ranges", async () => {
  const registry = new Map<string, Set<StaticRange>>();
  vi.stubGlobal("CSS", { ...CSS, highlights: registry });
  vi.stubGlobal(
    "Highlight",
    class extends Set<StaticRange> {
      constructor(...ranges: StaticRange[]) {
        super(ranges);
      }
    },
  );
  vi.stubGlobal(
    "StaticRange",
    class {
      constructor(init: StaticRangeInit) {
        Object.assign(this, init);
      }
    },
  );
  const text = Array.from({ length: 1600 }, (_, index) => (index % 2 ? "-old" : "+new")).join("\n");
  const panel = (key: string) =>
    createElement(ToolInspectionPanel, { key, block: diffBlock(text) });
  await act(async () => root.render([panel("first"), panel("second")]));
  const pre = container.querySelector("pre")!;
  expect(pre.textContent).toBe(text);
  expect(pre.querySelectorAll("*")).toHaveLength(1);
  const added = registry.get("bycoda-tool-diff-added")!;
  expect(added.size).toBe(1600);
  const first = [...added][0]!;
  expect(first.startContainer.textContent!.slice(first.startOffset, first.endOffset)).toBe(
    "+new\n",
  );
  await act(async () => root.render([panel("second")]));
  expect(added.size).toBe(800);
  expect(added.has(first)).toBe(false);
  await act(async () => root.render(null));
  expect(registry.size).toBe(0);
});
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

it.each(["  item: value\n  next: value\n", " \t\n"])(
  "copies retained whitespace unchanged: %j",
  async (output) => {
    const block: Block = {
      id: "whitespace",
      role: "tool",
      text: "Result",
      tool: { output, status: "completed" },
    };
    expect(hasToolInspection(block)).toBe(true);
    await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(clipboard.copy).toHaveBeenCalledExactlyOnceWith(output);
  },
);

it("drops an approval's details when they only repeat the command", () => {
  const command = "git status --short | head -5";
  const shell = (tool: Block["tool"]): Block => ({ id: "a", role: "tool", text: command, tool });
  const preview = { kind: "shell" as const, title: command };
  expect(approvalHasInspection(shell({ preview }), command)).toBe(false);
  expect(approvalHasInspection(shell({ preview, detail: `Bash: ${command}` }), command)).toBe(
    false,
  );
  expect(
    approvalHasInspection(
      shell({ preview: { ...preview, inspection: { kind: "command", text: command } } }),
      command,
    ),
  ).toBe(false);
  // Anything the request line does not show keeps the disclosure.
  expect(approvalHasInspection(shell({ preview, detail: "M src/a.ts" }), command)).toBe(true);
  expect(approvalHasInspection(diffBlock("+one"), "Edit")).toBe(true);
  expect(
    approvalHasInspection(
      { id: "m", role: "tool", text: "mcp__x__y", tool: { detail: 'mcp__x__y: {"id":1}' } },
      "mcp__x__y",
    ),
  ).toBe(true);
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
  expect(button.getAttribute("aria-label")).toBe("Copied");
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
  expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Copy");
  await act(async () => container.querySelector("button")!.click());
  expect(clipboard.copy).toHaveBeenLastCalledWith("second output");
});
it("wraps plain output by default and keeps the choice after Wrap lines is toggled", async () => {
  const block: Block = {
    id: "wrap",
    role: "tool",
    text: "Result",
    tool: { output: "a long line of output", status: "completed" },
  };
  await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
  const pre = container.querySelector("pre")!;
  expect(pre.getAttribute("data-wrap")).toBeNull();
  const wrapButton = container.querySelector<HTMLButtonElement>('button[aria-label="Wrap lines"]')!;
  expect(wrapButton.getAttribute("aria-pressed")).toBe("true");
  await act(async () => wrapButton.click());
  expect(container.querySelector("pre")!.getAttribute("data-wrap")).toBe("false");
  expect(localStorage.getItem("bycoda.toolOutputWrap")).toBe("0");
  await act(async () => wrapButton.click());
  expect(container.querySelector("pre")!.getAttribute("data-wrap")).toBeNull();
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

it("reads a recorded tool call's arguments as JSON, not shell text or scalars", () => {
  expect(
    toolCallArguments(
      'mcp__bycoda-conversation__conversation_agents_delegate: {"requestId":"a","n":2}',
    ),
  ).toEqual({ data: { requestId: "a", n: 2 } });
  expect(toolCallArguments('tools.search: [{"q":"x"}]')).toEqual({ data: [{ q: "x" }] });
  for (const text of ["git status", 'echo {"a":1}', "tool: 42", 'tool: {"a":', "no colon {}"])
    expect(toolCallArguments(text)).toBeNull();
});

it("parses saved JSON once across render and copy feedback, then refreshes changed output", async () => {
  const text = '{"result":{"cached":true}}';
  const changed = '{"result":{"cached":false}}';
  const block: Block = {
    id: "json-cache",
    role: "tool",
    text: "Result",
    tool: { output: text, status: "completed" },
  };
  const parse = vi.spyOn(JSON, "parse");
  try {
    await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
    await act(async () => container.querySelector("button")!.click());
    await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
    expect(parse.mock.calls.filter(([value]) => value === text)).toHaveLength(1);
    expect(clipboard.copy).toHaveBeenCalledWith(text);
    await act(async () =>
      root.render(
        createElement(ToolInspectionPanel, {
          block: { ...block, tool: { ...block.tool, output: changed } },
        }),
      ),
    );
    expect(parse.mock.calls.filter(([value]) => value === changed)).toHaveLength(1);
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  } finally {
    parse.mockRestore();
  }
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

it("shows one Copy JSON action on the card and no search toolbar for a small payload", async () => {
  const block: Block = {
    id: "small-json",
    role: "tool",
    text: "Result",
    tool: { output: '{"ok":true,"items":[1,2]}', status: "completed" },
  };
  await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
  expect(container.querySelector('button[aria-label="Copy JSON"]')).not.toBeNull();
  expect(container.querySelector('input[aria-label="Search JSON"]')).toBeNull();
  expect(container.querySelector('button[aria-label="Expand all"]')).toBeNull();
  const rows = container.querySelectorAll('[role="treeitem"]');
  expect(rows[0]!.querySelector("button")).toBeNull();
});

it("keeps search and expand controls for a large payload", async () => {
  const output = JSON.stringify({ items: Array.from({ length: 20 }, (_, i) => ({ id: i })) });
  const block: Block = {
    id: "big-json",
    role: "tool",
    text: "Result",
    tool: { output, status: "completed" },
  };
  await act(async () => root.render(createElement(ToolInspectionPanel, { block })));
  expect(container.querySelector('input[aria-label="Search JSON"]')).not.toBeNull();
  expect(jsonNodeCount({ a: [1, 2, 3] }, 12)).toBe(5);
  expect(
    jsonNodeCount(
      Array.from({ length: 100 }, () => 1),
      12,
    ),
  ).toBeLessThan(20);
});
