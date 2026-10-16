// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

const copy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));

it("collapses each fence independently, keeps its code mounted and copies the full text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, {
          text: "```text\nfirst\nsecond\n```\n\n```python\nx = 1\n```",
        }),
      ),
    );
    const shells = container.querySelectorAll<HTMLElement>(".markdown-code-shell");
    expect(shells).toHaveLength(2);
    const toggle = shells[0].querySelector<HTMLButtonElement>(".markdown-code-toggle")!;
    const body = shells[0].querySelector('[data-streamdown="code-block-body"]');
    expect(body).not.toBeNull();
    expect(shells[0].querySelector(".markdown-code-summary")).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand code block");
    expect(shells[0].dataset.collapsed).toBe("true");
    expect(shells[1].dataset.collapsed).toBe("false");
    expect(shells[0].querySelector(".markdown-code-summary-preview")?.textContent).toBe("first");
    expect(shells[0].querySelector(".markdown-code-summary-count")?.textContent).toBe("2 lines");
    expect(shells[0].querySelector('[data-streamdown="code-block-body"]')).toBe(body);
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeNull();
    await act(async () =>
      shells[0].querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!.click(),
    );
    expect(copy).toHaveBeenCalledWith("first\nsecond");
    act(() => shells[0].querySelector<HTMLButtonElement>(".markdown-code-summary")!.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(shells[0].dataset.collapsed).toBe("false");
    expect(shells[0].querySelector(".markdown-code-summary")).toBeNull();
    expect(shells[0].querySelector('[data-streamdown="code-block-body"]')).toBe(body);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("copies a long fence completely, reports failure and supports retry and selected text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const code = Array.from({ length: 300 }, (_, i) => `satır ${i}: bycoda`).join("\n");
  copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
  try {
    await act(async () =>
      root.render(createElement(AgentMarkdown, { text: `\`\`\`markdown\n${code}\n\`\`\`` })),
    );
    const shell = container.querySelector<HTMLElement>(".markdown-code-shell")!;
    const button = shell.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!;
    await act(async () => button.click());
    expect(button.getAttribute("aria-label")).toContain("Copy failed");
    expect(shell.querySelector('[role="status"]')?.textContent).toContain("Copy failed");
    await act(async () => button.click());
    expect(copy).toHaveBeenLastCalledWith(code);
    expect(button.getAttribute("aria-label")).toBe("Copied");
    const line = shell.querySelector('[data-streamdown="code-block-body"] code span')!;
    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.toString();
    await act(async () =>
      shell.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(copy).toHaveBeenLastCalledWith(selected);
  } finally {
    act(() => root.unmount());
    container.remove();
    window.getSelection()?.removeAllRanges();
    vi.unstubAllGlobals();
  }
});

it("copies a rendered table as Markdown from its top-right button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, {
          text: "| Uyarı | Adet |\n| --- | --- |\n| `then` isimli alan | 18 |\n| Kullanılmayan **import** | 90 |",
        }),
      ),
    );
    const shell = container.querySelector<HTMLElement>(".markdown-table-shell")!;
    expect(shell.querySelector('[data-streamdown="table-wrapper"]')).not.toBeNull();
    await act(async () =>
      shell.querySelector<HTMLButtonElement>('[aria-label="Copy table as Markdown"]')!.click(),
    );
    expect(copy).toHaveBeenLastCalledWith(
      "| Uyarı | Adet |\n| --- | --- |\n| then isimli alan | 18 |\n| Kullanılmayan import | 90 |",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
