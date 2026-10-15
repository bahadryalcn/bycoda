// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationAlerts } from "./NotificationsSettings";
import { NOTIFICATION_EVENT_SETTINGS } from "../../notifications/model/notificationEvents";

const permission = vi.hoisted(() => ({ value: "denied" }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_WIN: true, IS_MAC: false }));
vi.mock("../../notifications/model/notifications", () => ({
  cachedNotificationPermission: () => permission.value,
  loadNotificationsEnabled: () => false,
  saveNotificationsEnabled: vi.fn(),
  probeNotificationPermission: async () => permission.value,
  requestNotificationPermission: async () => permission.value,
  openNotificationSettings: async () => {
    throw new Error("Unavailable");
  },
}));
vi.mock("../model/bycodaSoundEngine", () => ({
  play: vi.fn(),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  permission.value = "denied";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps event choices and schedule findable while application alerts are off", async () => {
  await act(async () => root.render(createElement(NotificationAlerts)));
  for (const event of NOTIFICATION_EVENT_SETTINGS) {
    const control = container.querySelector<HTMLButtonElement>(
      `button[role="switch"][aria-label="${event.label}"]`,
    );
    expect(control, event.label).not.toBeNull();
    expect(control!.disabled).toBe(true);
    expect(control!.getAttribute("aria-checked")).toBe("true");
  }
  expect(container.textContent).toContain("Your choices are preserved.");
  expect(container.querySelector('[aria-label^="Daily summary time:"]')).not.toBeNull();
  expect(localStorage.getItem("bycoda.notifications.events.v1")).toBeNull();
});
it("reports denied permission and a failed system-settings action", async () => {
  await act(async () => root.render(createElement(NotificationAlerts)));
  expect(container.textContent).toContain("Notifications are blocked by system permission.");
  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open System Settings",
  )!;
  await act(async () => open.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not open system settings.",
  );
});
it("refreshes platform availability without enabling notifications", async () => {
  permission.value = "unsupported";
  await act(async () => root.render(createElement(NotificationAlerts)));
  expect(container.textContent).toContain("Not available on this platform");
  permission.value = "granted";
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("System permission granted");
  expect(
    container.querySelector('[aria-label="Notifications"]')?.getAttribute("aria-checked"),
  ).toBe("false");
});
