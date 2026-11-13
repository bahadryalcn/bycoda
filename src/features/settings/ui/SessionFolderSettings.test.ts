// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionFolderGroup, restoreSessionFolderDefault } from "./SessionFolderSettings";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), open: vi.fn() }));
vi.mock("../model/sessionFolder", () => ({
  loadSessionFolder: mocks.load,
  saveSessionFolder: mocks.save,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
it("refreshes mounted value after reset and guards duplicate pending pickers", async () => {
  mocks.load
    .mockResolvedValueOnce({ chosen: "C:\\custom", home: "C:\\home" })
    .mockResolvedValue({ chosen: null, home: "C:\\home" });
  mocks.save.mockResolvedValue(undefined);
  let cancel!: (value: null) => void;
  mocks.open.mockImplementation(
    () =>
      new Promise((resolve) => {
        cancel = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SessionFolderGroup)));
    expect(container.textContent).toContain("C:\\custom");
    await act(async () => restoreSessionFolderDefault());
    expect(container.textContent).toContain("C:\\home");
    expect(container.textContent).not.toContain("Use home folder");
    const choose = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Choose folder…",
    )!;
    await act(async () => {
      choose.click();
      choose.click();
    });
    expect(mocks.open).toHaveBeenCalledOnce();
    await act(async () => cancel(null));
    expect(choose.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("retains verified path on failed reset and ignores an old initial read", async () => {
  mocks.load.mockReset();
  mocks.save.mockReset();
  let initial!: (value: { chosen: string | null; home: string }) => void;
  mocks.load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          initial = resolve;
        }),
    )
    .mockResolvedValue({ chosen: null, home: "C:\\home" });
  mocks.save.mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SessionFolderGroup)));
    await act(async () => restoreSessionFolderDefault());
    await act(async () => initial({ chosen: "C:\\old", home: "C:\\home" }));
    expect(container.textContent).toContain("C:\\home");
    expect(container.textContent).not.toContain("C:\\old");
    mocks.save.mockRejectedValueOnce(new Error("reset denied"));
    await expect(restoreSessionFolderDefault()).rejects.toThrow("reset denied");
    expect(container.textContent).toContain("C:\\home");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("retains verified path and exposes failed native save", async () => {
  mocks.load.mockReset().mockResolvedValue({ chosen: "C:\\verified", home: "C:\\home" });
  mocks.save.mockReset().mockRejectedValue(new Error("folder denied"));
  mocks.open.mockReset().mockResolvedValue("C:\\new");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SessionFolderGroup)));
    const choose = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Choose folder…",
    )!;
    await act(async () => choose.click());
    expect(container.textContent).toContain("folder denied");
    expect(container.textContent).toContain("C:\\verified");
    expect(container.textContent).not.toContain("C:\\new");
    expect(choose.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
