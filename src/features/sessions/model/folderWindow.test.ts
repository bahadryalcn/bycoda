import { expect, it } from "vitest";
import { folderSessionWindow } from "./folderWindow";
it("bounds a huge expanded folder while retaining a distant active session and every page", () => {
  const sessions = Array.from({ length: 10000 }, (_, index) => ({ id: String(index) }));
  const first = folderSessionWindow(sessions, 40, "9999");
  expect(first).toHaveLength(41);
  expect(first.at(-1)?.id).toBe("9999");
  const next = folderSessionWindow(sessions, 80, "9999");
  expect(next.slice(0, 80)).toEqual(sessions.slice(0, 80));
  expect(folderSessionWindow(sessions, sessions.length, "9999")).toEqual(sessions);
  expect(folderSessionWindow(sessions, 40, "2")).toHaveLength(40);
});
