// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { forgetBrowserUrl, readBrowserRecents, rememberBrowserUrl } from "./browserRecents";

beforeEach(() => localStorage.clear());

it("keeps the latest addresses first without duplicates and within the limit", () => {
  for (const port of [1, 2, 3, 4, 5, 6, 7]) rememberBrowserUrl(`http://localhost:300${port}`);
  rememberBrowserUrl("http://localhost:3003");
  const recents = readBrowserRecents();
  expect(recents).toHaveLength(6);
  expect(recents[0]).toBe("http://localhost:3003/");
  expect(new Set(recents).size).toBe(recents.length);
  expect(recents).not.toContain("http://localhost:3001/");
});

it("never stores credentials, other schemes or invalid input", () => {
  rememberBrowserUrl("http://user:secret@localhost:3000");
  rememberBrowserUrl("file:///etc/passwd");
  rememberBrowserUrl("not a url");
  expect(readBrowserRecents()).toEqual([]);
});

it("forgets one address and tolerates corrupt storage", () => {
  rememberBrowserUrl("http://localhost:3000");
  rememberBrowserUrl("http://localhost:5173");
  expect(forgetBrowserUrl("http://localhost:3000/")).toEqual(["http://localhost:5173/"]);
  localStorage.setItem("bycoda.hostBrowser.recentUrls", "{broken");
  expect(readBrowserRecents()).toEqual([]);
});
