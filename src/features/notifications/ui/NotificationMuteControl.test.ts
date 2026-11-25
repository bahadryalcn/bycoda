// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import { NotificationMuteControl } from "./NotificationMuteControl";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) =>
      item.textContent === label ||
      item.getAttribute("aria-label") === label ||
      item.textContent?.startsWith(`${label} (`),
  );
  expect(button, `Button ${label}`).toBeDefined();
  act(() => button!.click());
}

function buttonWithText(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  expect(button, `Button ${text}`).toBeDefined();
  return button!;
}

const pickTime = (hour: number, minute: number) => {
  for (const [label, index] of [
    ["Hour", hour],
    ["Minute", minute],
  ] as const)
    act(() =>
      document
        .querySelectorAll<HTMLButtonElement>(
          `[role="listbox"][aria-label="${label}"] [role="option"]`,
        )
        [index].click(),
    );
};

describe("NotificationMuteControl", () => {
  it("dismisses a custom deadline when the selected projects change", () => {
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    click("Mute");
    click("Choose date and time");
    pickTime(17, 35);
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["personal"] })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(loadNotificationPreferences()).toEqual({});
  });

  it("dismisses duration presets when the selected projects change", () => {
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    click("Mute");
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["personal"] })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(loadNotificationPreferences()).toEqual({});
  });

  it("keeps the custom draft when the same selection is reordered", () => {
    vi.mocked(Date.now).mockReturnValue(new Date(2030, 0, 15, 12).getTime());
    act(() =>
      root.render(createElement(NotificationMuteControl, { projectIds: ["private", "personal"] })),
    );
    click("Mute");
    click("Choose date and time");
    pickTime(17, 35);
    act(() =>
      root.render(createElement(NotificationMuteControl, { projectIds: ["personal", "private"] })),
    );
    click("Mute until then");
    for (const id of ["private", "personal"])
      expect(loadNotificationPreferences()[id].mutedUntil).toBe(
        new Date(2030, 0, 15, 17, 35).getTime(),
      );
  });

  it("pauses resume and mute when saved choices cannot be read and recovers without resetting intent", () => {
    updateNotificationPreferences(["private"], { disabled: ["issues"], mutedUntil: null });
    localStorage.setItem("bycoda.projectNotifications.v1", "{broken");
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    const resume = buttonWithText("Resume notifications");
    const mute = buttonWithText("Mute");
    expect(resume.getAttribute("aria-disabled") === "true").toBe(true);
    expect(mute.getAttribute("aria-disabled") === "true").toBe(true);
    act(() => {
      localStorage.setItem(
        "bycoda.projectNotifications.v1",
        JSON.stringify({ private: { disabled: ["issues"], mutedUntil: null } }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.projectNotifications.v1" }));
    });
    expect(resume.getAttribute("aria-disabled") === "true").toBe(false);
    expect(mute.getAttribute("aria-disabled") === "true").toBe(false);
    expect(loadNotificationPreferences().private.disabled).toEqual(["issues"]);
    expect(loadNotificationPreferences().private.mutedUntil).toBeNull();
  });

  it("keeps a custom deadline draft through an unavailable-read pause", () => {
    vi.mocked(Date.now).mockReturnValue(new Date(2030, 0, 15, 12).getTime());
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    click("Mute");
    click("Choose date and time");
    pickTime(17, 35);
    const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    act(() => {
      localStorage.setItem("bycoda.projectNotifications.v1", "{broken");
      window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.projectNotifications.v1" }));
    });
    expect(submit.getAttribute("aria-disabled") === "true").toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      localStorage.setItem("bycoda.projectNotifications.v1", "{}");
      window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.projectNotifications.v1" }));
    });
    expect(submit.getAttribute("aria-disabled") === "true").toBe(false);
    click("Mute until then");
    expect(loadNotificationPreferences().private.mutedUntil).toBe(
      new Date(2030, 0, 15, 17, 35).getTime(),
    );
  });

  it("mutes selected projects for eight hours without replacing category choices", () => {
    updateNotificationPreferences(["private"], { disabled: ["issues"] });
    act(() =>
      root.render(
        createElement(NotificationMuteControl, {
          projectIds: ["private", "personal"],
        }),
      ),
    );
    click("Mute");
    click("8 hours");
    expect(loadNotificationPreferences()).toEqual({
      private: { disabled: ["issues"], mutedUntil: 1_800_028_800_000 },
      personal: { disabled: [], mutedUntil: 1_800_028_800_000 },
    });
  });

  it("resumes notifications while preserving the project's chosen categories", () => {
    updateNotificationPreferences(["private"], {
      disabled: ["issues"],
      mutedUntil: null,
    });
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    expect(container.textContent).toContain("Muted until resumed");
    click("Resume notifications");
    expect(loadNotificationPreferences().private.disabled).toEqual(["issues"]);
    expect(loadNotificationPreferences().private.mutedUntil).toBeUndefined();
    expect(container.textContent).not.toContain("Muted until resumed");
  });

  it("accepts a custom future time and rejects an expired one without saving", () => {
    vi.mocked(Date.now).mockReturnValue(new Date(2030, 0, 15, 12).getTime());
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    click("Mute");
    click("Choose date and time");
    expect(
      [...document.querySelectorAll("button")].some((button) => button.textContent === "1 hour"),
    ).toBe(false);
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(document.querySelector('[role="grid"]')).not.toBeNull();
    expect(
      document.querySelector('button[type="submit"]')?.getAttribute("data-button-hierarchy"),
    ).toBe("primary");
    act(() => document.querySelector<HTMLButtonElement>('button[data-date="2030-01-15"]')!.click());
    pickTime(8, 0);
    click("Mute until then");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("future");
    expect(loadNotificationPreferences().private).toBeUndefined();
    act(() => document.querySelector<HTMLButtonElement>('button[data-date="2030-01-16"]')!.click());
    pickTime(17, 0);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    click("Mute until then");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(
      document.querySelector('[role="listbox"][aria-label="Hour"] [aria-selected="true"]')
        ?.textContent,
    ).toContain("5");
    write.mockRestore();
    click("Mute until then");
    expect(loadNotificationPreferences().private.mutedUntil).toBe(
      new Date(2030, 0, 16, 17).getTime(),
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("Mute");
  });

  it("names text triggers by their visible label and keeps the icon-only trigger named", () => {
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    expect(buttonWithText("Mute").hasAttribute("aria-label")).toBe(false);
    act(() =>
      root.render(
        createElement(NotificationMuteControl, { projectIds: ["private"], compact: true }),
      ),
    );
    expect(container.querySelector('button[aria-label="Mute notifications"]')).not.toBeNull();

    updateNotificationPreferences(["private"], { mutedUntil: null });
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(NotificationMuteControl, { projectIds: ["private"] })));
    expect(buttonWithText("Mute").hasAttribute("aria-label")).toBe(false);
    expect(buttonWithText("Resume notifications").hasAttribute("aria-label")).toBe(false);
  });
});
