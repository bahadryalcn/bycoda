// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeNameDialog } from "./ThemeNameDialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "keeps IME Enter in the name field (%j)",
  async (ime) => {
    const onSubmit = vi.fn();
    act(() =>
      root.render(
        createElement(ThemeNameDialog, {
          title: "Save current look",
          confirmLabel: "Save",
          initialName: "夜",
          onSubmit,
          onClose: vi.fn(),
        }),
      ),
    );
    await act(async () => {
      document.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          ...ime,
        }),
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  },
);

it("keeps name unchanged while a save is pending and retains it on failure", async () => {
  let reject!: (error: Error) => void;
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  act(() =>
    root.render(
      createElement(ThemeNameDialog, {
        title: "Save current look",
        confirmLabel: "Save",
        initialName: "Night",
        onSubmit,
        onClose: vi.fn(),
      }),
    ),
  );
  await act(async () => {
    document
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(document.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  await act(async () => reject(new Error("Storage unavailable")));
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Night");
  expect(document.querySelector<HTMLInputElement>("input")!.disabled).toBe(false);
  expect(document.body.textContent).toContain("Storage unavailable");
});
