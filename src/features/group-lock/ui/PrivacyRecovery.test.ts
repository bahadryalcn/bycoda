// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { GroupLockControls } from "./GroupLockSettings";
const state = vi.hoisted(() => ({
  privacy: {
    hasPassword: false,
    hiddenGroupsAuthorized: false,
    groups: [{ id: "synthetic", name: "Synthetic hidden name" }],
    savedHiddenGroupIds: new Set(["synthetic"]),
    hiddenGroupIds: new Set(["synthetic"]),
  },
  recover: vi.fn(async () => {}),
  restore: vi.fn(async () => false),
}));
vi.mock("../hooks/useGroupLock", () => ({ useGroupLock: () => state.privacy }));
vi.mock("../model/roomPrivacyProjection", () => ({ recoverRoomPrivacyProjection: state.recover }));
vi.mock("../model/groupLock", () => ({
  authorizeHiddenGroups: vi.fn(),
  closeHiddenGroups: vi.fn(),
  hideGroup: vi.fn(),
  restoreHiddenGroup: state.restore,
}));
import { HiddenGroupsSettings } from "./HiddenGroupsSettings";
const controls: Pick<GroupLockControls, "Group" | "Row"> = {
  Group: ({ children }) => createElement("section", null, children),
  Row: ({ label, children }) => createElement("div", null, label, children),
};
it("shows one recovery in progress, retains failure, and never exposes revoked names", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    act(async () => root.render(createElement(HiddenGroupsSettings, { controls })));
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
  await render();
  await act(async () => button("Make visible").click());
  let reject!: (error: Error) => void;
  state.recover.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const check = button("Check status");
  await act(async () => {
    check.click();
    check.click();
  });
  expect(state.recover).toHaveBeenCalledOnce();
  expect(check.getAttribute("aria-busy")).toBe("true");
  expect(button("Make visible").disabled).toBe(true);
  state.privacy.hasPassword = true;
  await render();
  expect(host.textContent).not.toContain("Synthetic hidden name");
  await act(async () => reject(new Error("recovery failed")));
  expect(host.textContent).toContain("Visibility could not be confirmed.");
  expect(check.getAttribute("aria-busy")).toBeNull();
  expect(host.textContent).not.toContain("Synthetic hidden name");
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
