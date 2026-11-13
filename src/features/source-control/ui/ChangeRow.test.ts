// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChangeRow } from "./ChangeRow";

vi.mock("../../files/public/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
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

it.each(["staged", "unstaged"] as const)(
  "opens deleted %s entries as diffs while keeping physical-file actions disabled",
  async (kind) => {
    const onOpenFile = vi.fn();
    const onOpenInEditor = vi.fn();
    const props: ComponentProps<typeof ChangeRow> = {
      file: {
        path: "/repo/deleted.ts",
        relative: "deleted.ts",
        status: "deleted",
        additions: 0,
        deletions: 4,
        staged: true,
        unstaged: true,
      },
      kind,
      active: false,
      busy: false,
      onOpenFile,
      onOpenInEditor,
      onAction: vi.fn(),
    };
    await act(async () => root.render(createElement(ChangeRow, props)));
    const row = host.querySelector<HTMLButtonElement>("[data-git-file]")!;
    await act(async () => row.click());
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(props.file.path, kind);
    await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onOpenFile).toHaveBeenLastCalledWith(props.file.path, kind, true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Actions for deleted.ts"]')!.click(),
    );
    const physicalOpen = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].filter((item) => item.textContent?.startsWith("Open in "));
    expect(physicalOpen.length).toBeGreaterThan(0);
    expect(
      physicalOpen.every((item) => item.disabled || item.getAttribute("aria-disabled") === "true"),
    ).toBe(true);
    expect(onOpenInEditor).not.toHaveBeenCalled();
  },
);
