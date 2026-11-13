// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AdditionalDirsDialog } from "./AdditionalDirsDialog";
import { loadAdditionalDirs, saveAdditionalDirs } from "../model/additionalDirs";

const folder = "/work/çok-uzun-proje-👩🏽‍💻/مساحة-العمل/" + "long-folder-name".repeat(12);
vi.mock("../model/recents", async (original) => ({
  ...(await original<typeof import("../model/recents")>()),
  useRecents: () => [],
}));
vi.mock("../model/projectGroups", async (original) => ({
  ...(await original<typeof import("../model/projectGroups")>()),
  useProjectGroupAssignments: () => ({}),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

it("retains a permission on rejected revocation and exposes the full folder identity", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  expect(saveAdditionalDirs("/work/main", [folder])).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let write: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await act(async () =>
      root.render(
        createElement(AdditionalDirsDialog, {
          project: "/work/main",
          name: "Main",
          onClose: () => {},
        }),
      ),
    );
    const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(input.checked).toBe(true);
    expect(host.textContent).toContain(folder);
    const exactPath = [...host.querySelectorAll("span")].find(
      (node) => node.textContent === folder,
    );
    expect(exactPath?.getAttribute("data-wrap")).toBe("anywhere");
    write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await act(async () => input.click());
    expect(input.checked).toBe(true);
    expect(loadAdditionalDirs("/work/main")).toEqual([folder]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save project changes",
    );
  } finally {
    write?.mockRestore();
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
