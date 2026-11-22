// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountPairPlan } from "../model/accountDesktopPairing";
import type { AccountPairView } from "./useAccountDesktopPair";

const pair = vi.hoisted(() => ({
  view: { step: "waiting", code: "123456" } as AccountPairView,
}));
vi.mock("./useAccountDesktopPair", () => ({
  useAccountDesktopPair: () => ({ view: pair.view, retry: vi.fn(), signedIn: true }),
}));

import { AccountPairDialog } from "./AccountPairDialog";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

it("shows the computer name in the dialog title with every slot filled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const plan = { name: "Work Mac", routes: [] } as unknown as AccountPairPlan;
  await act(async () =>
    root.render(createElement(AccountPairDialog, { plan, onClose: vi.fn(), onPaired: vi.fn() })),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const text = document.body.textContent ?? "";
  expect(text).toContain("Add Work Mac");
  expect(text).toContain("Allow it on Work Mac.");
  expect(text).not.toContain("{");
});
