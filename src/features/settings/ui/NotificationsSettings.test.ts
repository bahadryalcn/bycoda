// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationAlerts } from "./NotificationsSettings";
import { NOTIFICATION_EVENT_SETTINGS } from "../../notifications/model/notificationEvents";
import { saveNotificationsEnabled } from "../../notifications/model/notifications";

const permission = vi.hoisted(() => ({ value: "denied", windows: true }));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  listenSystemPermissionsChanged: () => () => {},
  systemPermissionsStatus: async () => {
    if (permission.value === "unavailable") throw new Error("Unavailable");
    return {
      version: 1,
      platform: "windows",
      signing: "unknown",
      elevated: false,
      entries: [
        {
          id: "notifications",
          state: permission.value === "unsupported" ? "not-required" : permission.value,
          canRequest: false,
          canOpenSettings: true,
        },
      ],
    };
  },
}));
vi.mock("../../../platform/tauri/platform", () => ({
  get IS_WIN() {
    return permission.windows;
  },
  IS_MAC: false,
}));
vi.mock("../../notifications/model/notifications", () => ({
  cachedNotificationPermission: () => permission.value,
  loadNotificationsEnabled: () => false,
  saveNotificationsEnabled: vi.fn(),
  subscribeNotificationsEnabled: () => () => {},
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
  permission.windows = true;
  vi.mocked(saveNotificationsEnabled).mockReset().mockReturnValue(true);
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
  expect(
    container
      .querySelector('[data-setting-id="notification-event-finished"]')
      ?.getAttribute("data-dependent"),
  ).toBeTruthy();
  expect(container.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull();
  expect(localStorage.getItem("bycoda.notifications.events.v1")).toBeNull();
});
it("shows shared OS permission status separately from desktop delivery intent", async () => {
  await act(async () => root.render(createElement(NotificationAlerts)));
  const row = container.querySelector('[data-setting-id="permission-notifications"]')!;
  expect(row.textContent).toContain("Not allowed");
  expect(row.querySelector("button")).not.toBeNull();
  expect(saveNotificationsEnabled).not.toHaveBeenCalled();
});
it("refreshes platform availability without enabling notifications", async () => {
  permission.value = "unsupported";
  await act(async () => root.render(createElement(NotificationAlerts)));
  expect(container.textContent).toContain("Not required");
  permission.value = "granted";
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Allowed");
  expect(
    container.querySelector('[aria-label="Desktop notifications"]')?.getAttribute("aria-checked"),
  ).toBe("false");
});

it("preserves event choices when desktop delivery is paused and resumed", async () => {
  permission.value = "granted";
  await act(async () => root.render(createElement(NotificationAlerts)));
  const delivery = container.querySelector<HTMLButtonElement>(
    '[aria-label="Desktop notifications"]',
  )!;
  const finished = container.querySelector<HTMLButtonElement>('[aria-label="Agent finished"]')!;
  await act(async () => delivery.click());
  expect(finished.disabled).toBe(false);
  await act(async () => finished.click());
  expect(finished.getAttribute("aria-checked")).toBe("false");
  await act(async () => delivery.click());
  expect(finished.disabled).toBe(true);
  await act(async () => delivery.click());
  expect(finished.disabled).toBe(false);
  expect(finished.getAttribute("aria-checked")).toBe("false");
});

it("retains a valid non-hour schedule value instead of snapping it to a listed hour", async () => {
  localStorage.setItem("bycoda.notifications.dailySummary.time", "09:35");
  await act(async () => root.render(createElement(NotificationAlerts)));
  expect(
    [...container.querySelectorAll('button[aria-haspopup="dialog"]')].some((trigger) =>
      trigger.textContent?.includes("9:35"),
    ),
  ).toBe(true);
  expect(localStorage.getItem("bycoda.notifications.dailySummary.time")).toBe("09:35");
});

it("keeps a rejected preference unchanged and retries beside its initiating control", async () => {
  vi.mocked(saveNotificationsEnabled).mockReturnValueOnce(false).mockReturnValue(true);
  await act(async () => root.render(createElement(NotificationAlerts)));
  const delivery = container.querySelector<HTMLButtonElement>(
    '[aria-label="Desktop notifications"]',
  )!;
  const row = delivery.closest(".settings-row")!;
  await act(async () => delivery.click());
  expect(delivery.getAttribute("aria-checked")).toBe("false");
  expect(row.querySelector('[role="alert"]')?.textContent).toContain("Could not save changes");
  const retry = [...row.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Retry",
  )!;
  await act(async () => retry.click());
  expect(delivery.getAttribute("aria-checked")).toBe("true");
  expect(row.querySelector('[role="alert"]')).toBeNull();
});

it("offers read-only recovery for unavailable permission status", async () => {
  permission.value = "unavailable";
  await act(async () => root.render(createElement(NotificationAlerts)));
  expect(container.textContent).toContain("Status unavailable");
  permission.value = "granted";
  const refresh = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Check again",
  )!;
  await act(async () => refresh.click());
  expect(container.textContent).toContain("Allowed");
  expect(saveNotificationsEnabled).not.toHaveBeenCalled();
});

it("explains the first unmet delivery-time prerequisite without changing saved choices", async () => {
  localStorage.setItem("bycoda.notifications.dailySummary.enabled", "0");
  await act(async () => root.render(createElement(NotificationAlerts)));
  const time = container.querySelector('[aria-label="Daily summary time"]')!;
  const row = time.closest(".settings-row")!;
  expect(row.textContent).toContain("Enable Desktop notifications first");
  expect(row.textContent).not.toContain("Enable Daily summary first");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Desktop notifications"]')!.click(),
  );
  expect(row.textContent).toContain("Enable Daily summary first");
  expect(row.textContent).not.toContain("Enable Desktop notifications first");
});

it("names Windows availability instead of an already-enabled desktop prerequisite", async () => {
  permission.windows = false;
  await act(async () => root.render(createElement(NotificationAlerts)));
  const row = container.querySelector('[data-setting-id="notification-event-taskbar"]')!;
  expect(row.textContent).toContain("Enable Desktop notifications first");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Desktop notifications"]')!.click(),
  );
  expect(row.textContent).not.toContain("Enable Desktop notifications first");
  expect(row.textContent).toContain("Taskbar badges and flashing are available only on Windows.");
  expect(row.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
});

it("toggles sounds independently of desktop notification intent", async () => {
  await act(async () => root.render(createElement(NotificationAlerts)));
  const sounds = container.querySelector<HTMLButtonElement>('[aria-label="Sounds"]')!;
  await act(async () => sounds.click());
  expect(localStorage.getItem("bycoda.sounds")).toBe("0");
  expect(sounds.getAttribute("aria-checked")).toBe("false");
  expect(saveNotificationsEnabled).not.toHaveBeenCalled();
  await act(async () => sounds.click());
  expect(sounds.getAttribute("aria-checked")).toBe("true");
  expect(saveNotificationsEnabled).not.toHaveBeenCalled();
});
