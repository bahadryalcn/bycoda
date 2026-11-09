// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountData } from "./AccountData";

const mocks = vi.hoisted(() => ({ days: 1 }));

vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: vi.fn() }));
vi.mock("./AccountPrivacy", () => ({ AccountPrivacy: () => null }));
vi.mock("../hooks/useAccountData", () => ({
  useDataSummary: () => ({
    isPending: false,
    isError: false,
    data: {
      devices: { active: 1, revoked: 0 },
      activity: { days: mocks.days, totalMinutes: 60 },
      notifications: { feedItems: 0 },
      support: { tickets: 0 },
      exports: { ready: 0 },
    },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("account data summary", () => {
  it.each([
    [1, "1 day, 1h 00m in total"],
    [2, "2 days, 1h 00m in total"],
  ])("pluralises the active days (%i)", async (days, text) => {
    mocks.days = days;
    await act(async () => root.render(createElement(AccountData)));
    expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain("1 days");
  });
});
