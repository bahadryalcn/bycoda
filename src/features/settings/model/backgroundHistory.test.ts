// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { loadBackgroundHistory, rememberBackground } from "./backgroundHistory";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("keeps disabled and previous selections, dedupes, bounds and separates project scope", () => {
  rememberBackground(["/old.png", "/new.html", "/old.png"]);
  rememberBackground(["/video.mp4"], "project");
  expect(loadBackgroundHistory()).toEqual(["/old.png", "/new.html"]);
  expect(loadBackgroundHistory("project")).toEqual(["/video.mp4"]);
  rememberBackground(Array.from({ length: 40 }, (_, index) => `/scene${index}.html`));
  expect(loadBackgroundHistory()).toHaveLength(30);
});

it("does not overwrite an unreadable history or hide a persistence failure", () => {
  localStorage.setItem("bycoda.chatBackgroundHistory.v1", "broken");
  expect(() => rememberBackground(["/new.html"])).toThrow();
  expect(localStorage.getItem("bycoda.chatBackgroundHistory.v1")).toBe("broken");
  localStorage.clear();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => rememberBackground(["/new.html"])).toThrow("quota");
});
