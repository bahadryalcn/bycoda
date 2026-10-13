// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RenameProjectFolderDialog } from "./RenameProjectFolderDialog";
import { folderRenameError } from "../model/projectFolderRename";

it("rejects paths and reserved names while allowing Turkish folder names", () => {
  for (const name of ["", ".", "..", "../other", "a/b", "a\\b", "CON", "nul.txt", "name.", " name"])
    expect(folderRenameError(name)).not.toBeNull();
  expect(folderRenameError("Ödeme uygulaması")).toBeNull();
});

it("keeps the folder dialog and entered name available after a failed rename, then retries", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onRename = vi
    .fn()
    .mockRejectedValueOnce(new Error("Folder already exists"))
    .mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(RenameProjectFolderDialog, { path: "/work/old", onRename, onClose }),
      ),
    );
    const input = document.querySelector<HTMLInputElement>("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "new");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Folder already exists");
    expect(input.value).toBe("new");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onRename).toHaveBeenLastCalledWith("new");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
