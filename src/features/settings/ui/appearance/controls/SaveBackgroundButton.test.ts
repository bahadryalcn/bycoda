// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SaveBackgroundButton } from "./SaveBackgroundButton";
import { prepareBackgroundName, saveBackgroundName } from "../../../runtime/nameBackground";
vi.mock("../../../model/savedThemes", async (original) => ({
  ...(await original<typeof import("../../../model/savedThemes")>()),
  useSavedThemes: () => [],
}));
vi.mock("../../../runtime/nameBackground", () => ({
  prepareBackgroundName: vi.fn(),
  saveBackgroundName: vi.fn(),
}));
vi.mock("../../../model/appearanceSnapshot", async (original) => ({
  ...(await original<typeof import("../../../model/appearanceSnapshot")>()),
  captureAppearanceSnapshot: vi.fn(() => {
    throw new Error("Snapshot unavailable");
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  vi.clearAllMocks();
});
it("keeps the original naming target and edited form when selection changes or saving fails", async () => {
  const expected = {
    id: "one",
    name: "Original",
    createdAt: 1,
    updatedAt: 1,
    look: {},
    imageId: "a".repeat(24),
  };
  vi.mocked(prepareBackgroundName).mockResolvedValue({ expected, image: undefined });
  let reject!: (cause: Error) => void;
  vi.mocked(saveBackgroundName).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  act(() => root.render(createElement(SaveBackgroundButton, { path: "/old.html", look: {} })));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  act(() => root.render(createElement(SaveBackgroundButton, { path: "/new.html", look: {} })));
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () =>
    [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save")!
      .click(),
  );
  expect(saveBackgroundName).toHaveBeenCalledWith(
    expect.objectContaining({ path: "/old.html", name: "Original", expected }),
  );
  expect(dialog.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  await act(async () => reject(new Error("Storage full")));
  expect(dialog.querySelector<HTMLInputElement>("input")!.value).toBe("Original");
  expect(dialog.textContent).toContain("Storage full");
  expect(dialog.querySelector<HTMLInputElement>("input")!.disabled).toBe(false);
});

it("releases pending ownership when reading the current appearance fails", async () => {
  act(() => root.render(createElement(SaveBackgroundButton, { path: "/old.html" })));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  // The raw cause sits behind Details; the row shows the translated failure.
  expect(host.textContent).toContain("Could not complete this action.");
  expect(host.textContent).not.toContain("Snapshot unavailable");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});
