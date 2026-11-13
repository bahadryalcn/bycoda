// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { browserDefaultViewport, toolPreferences } from "./toolPreferences";

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
