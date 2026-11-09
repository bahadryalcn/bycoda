// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { account, lead } = vi.hoisted(() => ({ account: vi.fn(), lead: vi.fn() }));
vi.mock("../../account", () => ({ useAccountContext: account }));
vi.mock("../../../platform/tauri/workspaceWindows", () => ({ isLeadWindow: lead }));
vi.mock("../model/notifications", () => ({
  isWindowFocused: () => true,
  notifyServerItem: vi.fn(async () => true),
}));
import { bindNotificationsServer, type NotificationsServerPort } from "../model/serverPort";
import { activeServerSync } from "../model/serverRuntime";
import { defaultNotificationSettings } from "@bycoda/account-contracts";
import { useServerNotifications } from "./useServerNotifications";

let root: Root;
const port: NotificationsServerPort = {
  getSettings: vi.fn(async () => defaultNotificationSettings()),
  putSettings: vi.fn(async (s) => s),
  listFeed: vi.fn(async () => ({ items: [], nextCursor: null })),
  markRead: vi.fn(async () => undefined),
  reportEvent: vi.fn(async () => undefined),
};
const Harness = () => {
  useServerNotifications();
  return null;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  lead.mockResolvedValue(true);
  bindNotificationsServer(port);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  bindNotificationsServer(null);
  vi.unstubAllGlobals();
});

it("makes no request and activates nothing while signed out", async () => {
  account.mockReturnValue(null);
  await act(async () => root.render(createElement(Harness)));
  for (const call of Object.values(port)) expect(call).not.toHaveBeenCalled();
  expect(activeServerSync()).toBeNull();
});

it("does nothing when no account service is bound", async () => {
  account.mockReturnValue({ user: { id: "u1" } });
  bindNotificationsServer(null);
  await act(async () => root.render(createElement(Harness)));
  expect(activeServerSync()).toBeNull();
});

it("syncs settings and the feed when signed in, and deactivates on sign-out", async () => {
  account.mockReturnValue({ user: { id: "u1" } });
  await act(async () => root.render(createElement(Harness)));
  expect(port.getSettings).toHaveBeenCalled();
  expect(port.listFeed).toHaveBeenCalled();
  expect(activeServerSync()).not.toBeNull();
  account.mockReturnValue(null);
  await act(async () => root.render(createElement(Harness)));
  expect(activeServerSync()).toBeNull();
});
