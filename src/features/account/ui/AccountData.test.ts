// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountData } from "./AccountData";

const mocks = vi.hoisted(() => ({
  days: 1,
  activityRetention: ["account_lifetime"],
  exportItem: null as null | { id: string; status: string; requestedAt: string; readyAt: string },
  request: vi.fn(async () => undefined),
  save: vi.fn(async () => undefined),
}));
const keep = ["account_lifetime"];

vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: vi.fn() }));
vi.mock("./AccountPrivacy", () => ({ AccountPrivacy: () => null }));
vi.mock("../hooks/useAccountData", () => ({
  useDataSummary: () => ({
    isPending: false,
    isError: false,
    data: {
      profile: { email: "ada@example.com", displayName: "Ada", createdAt: "2026-01-02T00:00:00Z" },
      devices: { active: 1, revoked: 0 },
      activity: { days: mocks.days, totalMinutes: 60 },
      notifications: { feedItems: 0 },
      support: { tickets: 0 },
      exports: { ready: 0 },
      retention: {
        profile: keep,
        devices: keep,
        activity: mocks.activityRetention,
        notifications: keep,
        support: keep,
        exports: keep,
      },
    },
  }),
  useDataExport: () => ({
    current: mocks.exportItem,
    follow: { isError: false },
    request: { isPending: false, mutateAsync: mocks.request },
    save: { isPending: false, isSuccess: false, mutateAsync: mocks.save },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.activityRetention = ["account_lifetime"];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("account data summary", () => {
  it("shows a shared retention rule once", async () => {
    await act(async () => root.render(createElement(AccountData)));
    expect(container.textContent?.match(/Kept while your account exists/g)).toHaveLength(1);
  });

  it("keeps category-specific retention when the rules differ", async () => {
    mocks.activityRetention = ["backups_30_days"];
    await act(async () => root.render(createElement(AccountData)));
    const activity = [...container.querySelectorAll(".settings-row")].find((row) =>
      row.textContent?.startsWith("Active time"),
    );
    expect(activity?.textContent).toContain("Backups kept 30 days");
    expect(container.textContent).toContain("Kept while your account exists");
  });

  it.each([
    [1, "1 day, 1h 00m in total"],
    [2, "2 days, 1h 00m in total"],
  ])("pluralises the active days (%i)", async (days, text) => {
    mocks.days = days;
    await act(async () => root.render(createElement(AccountData)));
    expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain("1 days");
  });

  it("requests an export in the app and saves it once ready", async () => {
    mocks.exportItem = null;
    await act(async () => root.render(createElement(AccountData)));
    const find = (text: string) =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === text);
    await act(async () => find("Request export")?.click());
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.exportItem = {
      id: "exp_1",
      status: "ready",
      requestedAt: "2026-11-09T00:00:00Z",
      readyAt: "2026-11-09T00:01:00Z",
    };
    await act(async () => root.render(createElement(AccountData)));
    await act(async () => find("Save file")?.click());
    expect(mocks.save).toHaveBeenCalledWith(mocks.exportItem);
    expect(container.textContent).toContain("Kept while your account exists");
  });
});
