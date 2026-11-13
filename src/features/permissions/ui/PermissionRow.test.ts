// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PermissionEntry } from "../../../platform/tauri/systemPermissions";

const state = vi.hoisted(() => ({
  entry: {
    id: "microphone",
    state: "granted",
    canRequest: false,
    canOpenSettings: false,
  } as PermissionEntry,
  refresh: vi.fn(async () => {}),
  request: vi.fn(async (_id: string): Promise<PermissionEntry> => state.entry),
}));
vi.mock("../hooks/usePermissionStatus", () => ({
  usePermissionStatus: () => ({
    entries: [state.entry],
    loading: false,
    failed: false,
    refresh: state.refresh,
  }),
}));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  requestSystemPermission: (id: string) => state.request(id),
}));
vi.mock("./PermissionSetupSheet", () => ({
  PermissionSetupSheet: () => createElement("div", { "data-testid": "setup-sheet" }),
}));
import { PermissionRow } from "./PermissionRow";

let root: Root | undefined;
let element: HTMLDivElement | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element?.remove();
  state.request.mockReset();
  state.refresh.mockClear();
  vi.unstubAllGlobals();
});

async function render() {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root!.render(createElement(PermissionRow, { id: "microphone" })));
  return element;
}
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);

it("interpolates permission consumers and helper state using supported locale slots", () => {
  const html = renderToStaticMarkup(
    createElement(PermissionRow, { id: "microphone", helperState: "denied" }),
  );
  expect(html).toContain("Used by: Dictation, voice and wake word");
  expect(html).toContain("Helper:");
  expect(html).not.toMatch(/\{(?:features|state|p0)\}/);
});

it("shows only the badge once access is ready", async () => {
  state.entry = { id: "microphone", state: "granted", canRequest: false, canOpenSettings: true };
  const host = await render();
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("Allowed");
});

it("shows the OS prompt in place and skips the guide when access is granted", async () => {
  state.entry = {
    id: "microphone",
    state: "not-determined",
    canRequest: true,
    canOpenSettings: true,
  };
  state.request.mockResolvedValueOnce({ ...state.entry, state: "granted", canRequest: false });
  const host = await render();
  await act(async () => button(host, "Allow")!.click());
  expect(state.request).toHaveBeenCalledExactlyOnceWith("microphone");
  expect(host.querySelector("[data-testid=setup-sheet]")).toBeNull();
  expect(state.refresh).toHaveBeenCalled();
});

it("opens the guide when the prompt leaves access missing", async () => {
  state.entry = {
    id: "microphone",
    state: "not-determined",
    canRequest: true,
    canOpenSettings: true,
  };
  state.request.mockResolvedValueOnce({ ...state.entry, state: "denied", canRequest: false });
  const host = await render();
  await act(async () => button(host, "Allow")!.click());
  expect(host.querySelector("[data-testid=setup-sheet]")).not.toBeNull();
});

it("opens the guide from Review access without prompting", async () => {
  state.entry = { id: "microphone", state: "denied", canRequest: false, canOpenSettings: true };
  const host = await render();
  await act(async () => button(host, "Review access…")!.click());
  expect(state.request).not.toHaveBeenCalled();
  expect(host.querySelector("[data-testid=setup-sheet]")).not.toBeNull();
});
