// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { consumeInstalledUpdate, rememberInstalledUpdate } from "../../model/updateNotice";
import { useUpdateNotices, type UpdateNotices } from "./useUpdateNotices";

let container: HTMLDivElement;
let root: Root;
let notices: UpdateNotices;

function Harness() {
  notices = useUpdateNotices({ installedUpdate: consumeInstalledUpdate() });
  return createElement("span", null, notices.updateNotice?.version ?? "dismissed");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("keeps the notice after reopening and reading notes, then dismisses it until the next update", () => {
  rememberInstalledUpdate("0.1.23");
  act(() => root.render(createElement(Harness)));
  expect(container.textContent).toBe("0.1.23");
  act(() => notices.onOpenWhatsNew("0.1.23"));
  expect(notices.whatsNewVersion).toBe("0.1.23");
  act(() => root.render(null));
  act(() => root.render(createElement(Harness)));
  expect(container.textContent).toBe("0.1.23");

  act(() => notices.onDismissUpdate());
  expect(container.textContent).toBe("dismissed");
  expect(consumeInstalledUpdate()).toBeNull();
  act(() => root.render(null));
  act(() => root.render(createElement(Harness)));
  expect(container.textContent).toBe("dismissed");

  rememberInstalledUpdate("0.1.24");
  act(() => root.render(null));
  act(() => root.render(createElement(Harness)));
  expect(container.textContent).toBe("0.1.24");
});

it("dismisses the displayed notice without clearing a newer installed version", () => {
  rememberInstalledUpdate("0.1.23");
  act(() => root.render(createElement(Harness)));
  rememberInstalledUpdate("0.1.24");
  act(() => notices.onDismissUpdate());
  expect(container.textContent).toBe("dismissed");
  expect(consumeInstalledUpdate()).toEqual({ version: "0.1.24" });
});
