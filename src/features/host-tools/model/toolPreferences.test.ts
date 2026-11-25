// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  browserDefaultViewport,
  resetToolPreferences,
  toolPreferences,
  ToolPreferencesResetError,
} from "./toolPreferences";

beforeEach(() => localStorage.clear());

it("validates stored values and saves", () => {
  const key = "bycoda.toolPreferences.browserViewport.v1";
  localStorage.setItem(key, "broken");
  expect(toolPreferences.browserViewport.load()).toBe("desktop");
  localStorage.setItem(key, JSON.stringify("invalid"));
  expect(browserDefaultViewport()).toEqual({ width: 1280, height: 720 });
  expect(() => toolPreferences.browserViewport.save("invalid" as never)).toThrow();
  toolPreferences.browserViewport.save("phone");
  expect(browserDefaultViewport()).toEqual({ width: 390, height: 844 });
  toolPreferences.browserViewport.save("4k");
  expect(browserDefaultViewport()).toEqual({ width: 3840, height: 2160 });
});

it("reports failed writes even when the previous value matches", () => {
  toolPreferences.browserLiveView.save(true);
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => toolPreferences.browserLiveView.save(true)).toThrow(
    "Could not save tool preference",
  );
  write.mockRestore();
});

it("subscribes to same-window and sibling-window changes", () => {
  const listener = vi.fn();
  const unsubscribe = toolPreferences.logsFollow.subscribe(listener);
  toolPreferences.logsFollow.save(false);
  window.dispatchEvent(
    new StorageEvent("storage", { key: "bycoda.toolPreferences.logsFollow.v1" }),
  );
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  toolPreferences.logsFollow.save(true);
  expect(listener).toHaveBeenCalledTimes(2);
});

it("validates custom viewport dimensions and address defaults", () => {
  toolPreferences.browserViewport.save("custom");
  toolPreferences.browserViewportWidth.save(500);
  toolPreferences.browserViewportHeight.save(800);
  expect(browserDefaultViewport()).toEqual({ width: 500, height: 800 });
  expect(() => toolPreferences.browserViewportWidth.save(239)).toThrow();
  expect(() => toolPreferences.browserViewportHeight.save(2161)).toThrow();
  expect(() => toolPreferences.browserHomeUrl.save("file:///secret")).toThrow();
  expect(() => toolPreferences.browserSearchTemplate.save("https://example.com/")).toThrow();
});

function blockWrites(blocked: (key: string, value: string) => boolean) {
  const write = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (blocked(key, value)) throw new Error("quota");
    write(key, value);
  });
}

it("exposes each canonical default and loads it when nothing is stored", () => {
  for (const preference of Object.values(toolPreferences)) {
    expect(preference.load()).toBe(preference.defaultValue);
  }
});

it("resets only the listed preferences to defaults and announces each change", () => {
  toolPreferences.logsFollow.save(false);
  toolPreferences.logsRefreshInterval.save(5000);
  toolPreferences.browserLiveView.save(false);
  const follow = vi.fn();
  const untouched = vi.fn();
  const unsubscribe = [
    toolPreferences.logsFollow.subscribe(follow),
    toolPreferences.browserLiveView.subscribe(untouched),
  ];
  resetToolPreferences(["logsFollow", "logsGrouped", "logsRefreshInterval"]);
  expect(toolPreferences.logsFollow.load()).toBe(true);
  expect(toolPreferences.logsRefreshInterval.load()).toBe(1500);
  expect(toolPreferences.browserLiveView.load()).toBe(false);
  expect(localStorage.getItem(toolPreferences.logsGrouped.key)).toBeNull();
  expect(follow).toHaveBeenCalledTimes(1);
  expect(untouched).not.toHaveBeenCalled();
  unsubscribe.forEach((stop) => stop());
});

it("replaces an unreadable stored value with the default", () => {
  localStorage.setItem(toolPreferences.logsFollow.key, "broken");
  resetToolPreferences(["logsFollow"]);
  expect(localStorage.getItem(toolPreferences.logsFollow.key)).toBe("true");
});

it("reset changes nothing and reports failure when an early write fails", () => {
  toolPreferences.logsFollow.save(false);
  toolPreferences.logsGrouped.save(false);
  toolPreferences.logsRefreshInterval.save(5000);
  const changed = vi.fn();
  const stop = toolPreferences.logsFollow.subscribe(changed);
  const blocked = blockWrites(
    (key, value) => key === toolPreferences.logsGrouped.key && value === "true",
  );
  let failure: unknown;
  try {
    resetToolPreferences(["logsFollow", "logsGrouped", "logsRefreshInterval"]);
  } catch (error) {
    failure = error;
  }
  blocked.mockRestore();
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(ToolPreferencesResetError);
  expect(toolPreferences.logsFollow.load()).toBe(false);
  expect(toolPreferences.logsGrouped.load()).toBe(false);
  expect(toolPreferences.logsRefreshInterval.load()).toBe(5000);
  expect(changed).not.toHaveBeenCalled();
  stop();
});

it("reset names the preferences it could not put back after a failed rollback", () => {
  toolPreferences.logsFollow.save(false);
  toolPreferences.logsGrouped.save(false);
  const changed = vi.fn();
  const stop = toolPreferences.logsFollow.subscribe(changed);
  const blocked = blockWrites(
    (key, value) =>
      (key === toolPreferences.logsGrouped.key && value === "true") ||
      (key === toolPreferences.logsFollow.key && value === "false"),
  );
  let failure: unknown;
  try {
    resetToolPreferences(["logsFollow", "logsGrouped"]);
  } catch (error) {
    failure = error;
  }
  blocked.mockRestore();
  expect(failure).toBeInstanceOf(ToolPreferencesResetError);
  expect((failure as ToolPreferencesResetError).unrestored).toEqual(["logsFollow"]);
  expect(toolPreferences.logsFollow.load()).toBe(true);
  expect(toolPreferences.logsGrouped.load()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(1);
  stop();
});
