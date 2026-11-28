// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

async function render(text: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(AgentMarkdown, { text })));
  await act(async () => {});
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const css = readFileSync(resolve(__dirname, "../../../styles/index.css"), "utf8");

function ruleFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1]!)
    .join("\n");
}

it("styles every heading level, strictly descending", () => {
  const px = (value: string) => {
    const token = value.match(/var\(--ui-font-(\w+)/)?.[1];
    const tokens: Record<string, number> = {
      micro: 11,
      caption: 12,
      secondary: 13,
      body: 14,
      title: 16,
      heading: 20,
    };
    return token ? tokens[token]! : Number.parseFloat(value);
  };
  const sizes = [1, 2, 3, 4, 5, 6].map((level) => {
    const block = ruleFor(`.agent-markdown [data-streamdown="heading-${level}"]`);
    const size = block.match(/font-size:\s*([^;]+);/)?.[1];
    expect(size, `heading-${level}`).toBeTruthy();
    return px(size!);
  });
  for (let index = 1; index < sizes.length; index += 1) {
    expect(sizes[index]).toBeLessThan(sizes[index - 1]!);
  }
});

it("shows only the checkbox on task list items and keeps nested bullets", async () => {
  const view = await render("- [x] done\n- [ ] todo\n  - nested bullet\n");
  try {
    const items = [...view.container.querySelectorAll("li")];
    const tasks = items.filter((item) => item.classList.contains("task-list-item"));
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(tasks.length).toBe(2);
    const nested = items.find((item) => item.firstChild?.textContent === "nested bullet");
    expect(nested?.classList.contains("task-list-item")).toBe(false);
    expect(ruleFor(".agent-markdown li.task-list-item")).toContain("list-style: none");
  } finally {
    await view.cleanup();
  }
});

it("keeps the header strip hidden for an unlabeled fence until collapsed", () => {
  expect(css.replace(/\s+/g, " ")).toContain(
    '.markdown-code-resizable[data-collapsed="false"] .markdown-code-fallback-label:empty ~ [data-streamdown="code-block"] [data-streamdown="code-block-header"] { display: none; }',
  );
  expect(css).not.toMatch(/\.markdown-code-resizable\[data-collapsed\]\s/);
});

it("keeps wrapped code lines aligned with the line-number gutter", () => {
  const wrapped = css.match(
    /html\.appearance-word-wrap \.agent-markdown \.markdown-code-numbered-line \{([^}]*)\}/,
  );
  expect(wrapped?.[1]).toContain("padding-inline-start");
  expect(wrapped?.[1]).toContain("text-indent");
});
