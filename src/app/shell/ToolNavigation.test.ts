// @vitest-environment happy-dom
import { act, createElement as h, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ToolHeader, ToolNavigationContext, ToolPanel } from "./ToolNavigation";
import type { ToolId } from "../model/toolWindows";
import { routeWindowDestination } from "../model/windowNavigation";

vi.mock("../model/windowNavigation", () => ({
  routeWindowDestination: vi.fn().mockResolvedValue(false),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/i18n", () => ({ t: (text: string) => text, useLocale: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.mocked(routeWindowDestination).mockResolvedValue(false);
});

async function mount(notesEnabled = true, grouped = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onSelect = vi.fn();
  await act(() =>
    root.render(
      h(
        ToolNavigationContext.Provider,
        { value: { active: "tasks", cwd: "/repo", notesEnabled, grouped, onSelect } },
        h(ToolHeader, null, "Title"),
      ),
    ),
  );
  return { container, onSelect };
}

it("shows only the selected tool in an individual window and offers the combined window", async () => {
  const { container } = await mount(true, false);
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(container.querySelector('[role="tab"]')?.textContent).toBe("Tasks");
  expect(container.querySelector('[aria-label="Open all tools in one window"]')).not.toBeNull();
});

it("offers all five tools with keyboard navigation and respects disabled Notes", async () => {
  const { container, onSelect } = await mount(false);
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  const tab = container.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
  await act(() =>
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(onSelect).toHaveBeenCalledWith("automations" satisfies ToolId);
  expect(document.activeElement?.textContent).toBe("Automations");
});

it("opens a separate tool or a combined tool window with the current project", async () => {
  const { container } = await mount();
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(5);
  await act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Open in new window"]')!.click(),
  );
  expect(invoke).toHaveBeenLastCalledWith("open_tool_window", {
    tool: "tasks",
    cwd: "/repo",
    grouped: false,
  });
  await act(() =>
    container.querySelector<HTMLButtonElement>('[title="Open all tools in one window"]')!.click(),
  );
  expect(invoke).toHaveBeenLastCalledWith("open_tool_window", {
    tool: "tasks",
    cwd: "/repo",
    grouped: true,
  });
});

it("reports a rejected native window and permits retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("window failed"));
  const { container } = await mount();
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Open in new window"]')!;
  await act(() => button.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("window failed");
  expect(button.disabled).toBe(false);
});

it("reveals the existing combined tools window instead of opening a duplicate", async () => {
  vi.mocked(routeWindowDestination).mockResolvedValueOnce(true);
  const { container } = await mount();
  await act(() =>
    container.querySelector<HTMLButtonElement>('[title="Open all tools in one window"]')!.click(),
  );
  expect(routeWindowDestination).toHaveBeenCalledWith({
    kind: "tool",
    tool: "tasks",
    cwd: "/repo",
    grouped: true,
  });
  expect(invoke).not.toHaveBeenCalled();
});

it("retains edits between tool tabs and suspends hidden listeners", async () => {
  const effect = vi.fn(),
    cleanup = vi.fn();
  function Editor() {
    const [value, setValue] = useState("");
    useEffect(() => {
      effect();
      return cleanup;
    }, []);
    return h("input", { value, onInput: (event) => setValue(event.currentTarget.value) });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const visibleRoot = createRoot(container);
  roots.push(visibleRoot);
  const render = (active: boolean) => visibleRoot.render(h(ToolPanel, { active }, h(Editor)));
  await act(() => render(false));
  expect(effect).not.toHaveBeenCalled();
  await act(() => render(true));
  const input = container.querySelector("input")!;
  await act(() => {
    input.value = "unsaved note";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => render(false));
  expect(cleanup).toHaveBeenCalled();
  await act(() => render(true));
  expect(container.querySelector("input")?.value).toBe("unsaved note");
});
