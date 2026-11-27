// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

const existing = new Set(["/repo/src", "/repo/docs/guide.pdf", "/repo/notes/plan"]);
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  statFiles: async (paths: string[]) =>
    paths.map((path) => ({
      path,
      mtimeMs: existing.has(path) && path !== "/repo/src" ? 1 : null,
      isDir: path === "/repo/src",
    })),
}));

describe("file reference chips", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onOpenFile = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onOpenFile.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(text: string) {
    await act(async () =>
      root.render(createElement(AgentMarkdown, { text, cwd: "/repo", onOpenFile })),
    );
  }

  it.each([
    "tabIndex",
    "images.generate",
    "logs.sources",
    "conversation_image_budget.session_id",
    "console.log",
    "array.map",
  ])("keeps the identifier `%s` as a neutral code chip with no icon", async (text) => {
    await render(`Use \`${text}\` here.`);
    const code = container.querySelector("code")!;
    expect(code.textContent).toBe(text);
    expect(code.classList.contains("file-ref")).toBe(false);
    expect(code.getAttribute("role")).toBeNull();
    expect(code.querySelector(".file-ref-icon, svg")).toBeNull();
  });

  it("shows an icon and the file kind on a known file written as code", async () => {
    await render("Edit `src/app.ts:12` next.");
    const chip = container.querySelector<HTMLElement>('code.file-ref[role="link"]')!;
    expect(chip.dataset.fileKind).toBe("code");
    expect(chip.querySelector(".file-ref-icon")).not.toBeNull();
    expect(chip.querySelector(".file-ref-label")?.textContent).toBe("src/app.ts");
    expect(chip.querySelector(".file-ref-location")?.textContent).toContain("L12");
    await act(async () => chip.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/src/app.ts", { line: 12 });
  });

  it("opens a code chip from the keyboard", async () => {
    await render("Read `notes.md`.");
    const chip = container.querySelector<HTMLElement>("code.file-ref")!;
    expect(chip.tabIndex).toBe(0);
    await act(async () => {
      chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onOpenFile).toHaveBeenCalledWith("/repo/notes.md", undefined);
  });

  it("styles a workspace file link as a chip and leaves a web link alone", async () => {
    await render("[ornek.pdf](ornek.pdf) and [site](https://example.com)");
    const [file, web] = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
    expect(file.classList.contains("file-ref")).toBe(true);
    expect(file.dataset.fileKind).toBe("docs");
    expect(file.querySelector(".file-ref-icon")).not.toBeNull();
    expect(web.classList.contains("file-ref")).toBe(false);
    expect(web.querySelector(".file-ref-icon")).toBeNull();
    await act(async () => file.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/ornek.pdf", undefined);
  });

  it("marks a folder the file system confirms as a folder", async () => {
    await render("Look in `/repo/src`.");
    const chip = container.querySelector<HTMLElement>("code.file-ref")!;
    expect(chip.dataset.fileKind).toBe("folder");
  });

  it("gives a path-like text that does not exist no chip", async () => {
    await render("Try `src/missing/` or `api/users/`.");
    expect(container.querySelector(".file-ref")).toBeNull();
  });
});
