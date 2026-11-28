// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) => `asset:${path}`,
  invoke: vi.fn(async () => "preview-token"),
}));

let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

async function render(text: string) {
  const root = createRoot(container);
  await act(async () => root.render(createElement(AgentMarkdown, { text, cwd: "/repo" })));
  await act(async () => {});
  return root;
}

it.each([
  ["NOTE", "Note"],
  ["TIP", "Tip"],
  ["IMPORTANT", "Important"],
  ["WARNING", "Warning"],
  ["CAUTION", "Caution"],
])("shows a > [!%s] quote as a titled note", async (marker, title) => {
  const root = await render(`> [!${marker}]\n> Read the **migration** guide.`);
  const note = container.querySelector('[data-markdown-alert]');
  expect(note?.getAttribute("data-markdown-alert")).toBe(marker.toLowerCase());
  expect(note?.textContent).toContain(title);
  expect(note?.textContent).toContain("Read the migration guide.");
  expect(container.textContent).not.toContain(`[!${marker}]`);
  expect(container.querySelector("blockquote")).toBeNull();
  await act(async () => root.unmount());
});

it("keeps an ordinary quote a quote", async () => {
  const root = await render("> Just a quote [!NOTE] in the middle.");
  expect(container.querySelector("blockquote")?.textContent).toContain("[!NOTE]");
  expect(container.querySelector("[data-markdown-alert]")).toBeNull();
  await act(async () => root.unmount());
});

it("draws inline and display math", async () => {
  const root = await render("Energy $E=mc^2$ here.\n\n$$\n\\int_0^1 x^2\\,dx\n$$");
  expect(container.querySelectorAll(".katex").length).toBe(2);
  expect(container.querySelector(".katex-display")).not.toBeNull();
  expect(container.textContent).not.toContain("$E=mc^2$");
  await act(async () => root.unmount());
});

it.each(["It costs $5 and $10 per seat.", "Input $3 / $15 per MTok.", "Set $HOME and $PATH first."])(
  "leaves dollar amounts as text: %s",
  async (text) => {
    const root = await render(text);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain(text);
    await act(async () => root.unmount());
  },
);

it("turns emoji shortcodes into emoji outside code", async () => {
  const root = await render("Ship it :rocket: and `keep :rocket:`");
  expect(container.textContent).toContain("Ship it 🚀");
  expect(container.querySelector("code")?.textContent).toContain(":rocket:");
  await act(async () => root.unmount());
});

it("keeps highlight and underline marks", async () => {
  const root = await render('<mark>key</mark> and <u>under</u> <span style="color:red">red</span>');
  expect(container.querySelector("mark")?.textContent).toBe("key");
  expect(container.querySelector("u")?.textContent).toBe("under");
  expect(container.querySelector("[style*='color']")).toBeNull();
  await act(async () => root.unmount());
});

it("previews a whole HTML document and keeps a fragment as code with a preview switch", async () => {
  const root = await render(
    "```html\n<!doctype html><html><body><h1>Hi</h1></body></html>\n```\n\n```html\n<div class=\"x\">part</div>\n```",
  );
  const previews = container.querySelectorAll("[data-html-fence-preview]");
  expect(previews.length).toBe(1);
  const switches = container.querySelectorAll('[aria-label="HTML view"]');
  expect(switches.length).toBe(2);
  await act(async () => root.unmount());
});

it("previews iframe srcdoc in the sandbox and keeps a remote frame a link", async () => {
  const root = await render(
    '<iframe srcdoc="<p>inline page</p>" title="Demo"></iframe>\n\n<iframe src="https://example.com/embed" title="Site"></iframe>',
  );
  expect(container.querySelector("[data-html-fence-preview]")).not.toBeNull();
  expect(container.querySelector('a[href="https://example.com/embed"]')?.textContent).toContain(
    "Site",
  );
  expect(container.querySelector("iframe[src^='https://example.com']")).toBeNull();
  await act(async () => root.unmount());
});
