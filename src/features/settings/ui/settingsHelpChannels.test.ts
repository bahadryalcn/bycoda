import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(join("src", "features", "settings", "ui", file), "utf8");

// A settings row keeps one help channel: a description (behind ⓘ) or an info popover, never both
// saying the same thing. These rows used to pass a description and a separate info popover.
it("does not repeat a row's description inside its info popover on Chat settings", () => {
  const chat = read("ChatSettings.tsx");
  expect(chat).not.toMatch(/description=\{t\("Continue automatically after a provider/);
  expect(chat).not.toMatch(/description=\{t\("Send Continue at launch when a turn/);
});

it("keeps one visible help channel for Delivery time on Notifications settings", () => {
  const notifications = read("NotificationsSettings.tsx");
  expect(notifications).not.toMatch(/description=\{t\("Uses this computer/);
  expect(notifications).toMatch(
    /info=\{\s*<InfoPopover label=\{t\("Daily summary"\)\}>[\s\S]*?local clock/,
  );
});

// The Windows-only fact is the Taskbar row's disabled reason, shown whether or not notifications
// are on, and is not repeated in an info popover.
it("shows the Taskbar Windows-only reason once, as the disabled reason", () => {
  const notifications = read("NotificationsSettings.tsx");
  expect(notifications).not.toMatch(/info=\{\s*event\.id === "taskbar"/);
  expect(notifications).not.toMatch(/notificationsEnabled && event\.id === "taskbar"/);
  expect(notifications).toMatch(/disabledReason=\{\s*event\.id === "taskbar" && !IS_WIN/);
});
