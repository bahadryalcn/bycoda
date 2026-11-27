import { expect, it } from "vitest";
import { roomDisclosureTargets } from "./assistant-room";

it("captures each Room project source once however many history rows share it", () => {
  const scope = (threadId: string, projects: string[]) => ({ threadId, projects, accounts: [] });

  expect(
    roomDisclosureTargets([
      scope("room", ["a"]),
      scope("room", ["a"]),
      scope("room", ["b", "a"]),
      scope("other", ["a"]),
    ]),
  ).toEqual([
    { threadId: "room", projectId: "a" },
    { threadId: "room", projectId: "b" },
    { threadId: "other", projectId: "a" },
  ]);
});
