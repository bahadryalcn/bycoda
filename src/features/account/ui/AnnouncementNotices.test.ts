// @vitest-environment happy-dom
import type { Announcement } from "@bycoda/account-contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announcementFeed } from "../model/announcementFeed";
import { ACCOUNT_CONTEXT } from "../model/testFixtures";
import { AnnouncementNotices } from "./AnnouncementNotices";

const mocks = vi.hoisted(() => ({
  state: { phase: "signed-out", notice: null, message: null } as unknown,
  listAnnouncements: vi.fn(),
  openExternal: vi.fn(async (_url: string) => undefined),
}));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mocks.openExternal }));
vi.mock("../hooks/useAccount", () => ({ useAccountState: () => mocks.state }));
vi.mock("../model/accountApi", () => ({
  accountApi: () => ({ listAnnouncements: mocks.listAnnouncements }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const signedIn = {
  phase: "signed-in",
  context: ACCOUNT_CONTEXT,
  deviceId: "dev_1",
  verifiedAt: 1,
  stale: false,
};
const news: Announcement = {
  id: "ann_1",
  title: "Maintenance tonight",
  body: "Short downtime at 22:00.",
  severity: "warning",
  publishedAt: "2026-11-08T10:00:00Z",
  url: "https://bycoda.codes/news",
};
const text = () => document.body.textContent ?? "";
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name)!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  announcementFeed.clear();
});

describe("announcement notices", () => {
  it("shows an unseen announcement to a signed-in account, with its link", async () => {
    mocks.state = signedIn;
    mocks.listAnnouncements.mockResolvedValue({ items: [{ ...news, id: "ann_link" }] });
    await act(async () => root.render(createElement(AnnouncementNotices)));
    expect(text()).toContain("Maintenance tonight");
    await act(async () => button("Read more").click());
    expect(mocks.openExternal).toHaveBeenCalledWith("https://bycoda.codes/news");
  });

  it("hides a dismissed announcement and remembers it by id", async () => {
    mocks.state = signedIn;
    mocks.listAnnouncements.mockResolvedValue({ items: [news] });
    await act(async () => root.render(createElement(AnnouncementNotices)));
    await act(async () => button("Dismiss").click());
    expect(text()).not.toContain("Maintenance tonight");
    expect(localStorage.getItem("bycoda.account.announcements.dismissed.v1")).toContain("ann_1");
  });

  it("fetches and shows nothing for a guest", async () => {
    mocks.state = { phase: "signed-out", notice: null, message: null };
    await act(async () => root.render(createElement(AnnouncementNotices)));
    expect(mocks.listAnnouncements).not.toHaveBeenCalled();
    expect(text()).toBe("");
  });
});
