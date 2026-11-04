import { expect, it } from "vitest";
import { recentBriefingNotes } from "./briefing-sources";
import { legacyUtcDayKey, ownerDayKey } from "../owner-day";
import type { AssistantNote } from "../../src/shared/model/host-contracts/assistant";

const note = (title: string, updatedAt: number) =>
  ({ id: title, title, tags: ["assistant"], body: "", updatedAt }) as unknown as AssistantNote;

it("reads owner-day and legacy UTC-keyed daily notes for the transition", () => {
  const now = Date.UTC(2026, 10, 3, 23, 30);
  const titles = [
    `Assistant · ${ownerDayKey(now)}`,
    `Assistant · ${legacyUtcDayKey(now)}`,
    "Assistant · 2020-01-01",
  ];
  const found = recentBriefingNotes(
    titles.map((title, index) => note(title, index)),
    now,
  ).map((item) => item.title);
  expect(found).toContain(titles[0]);
  expect(found).toContain(titles[1]);
  expect(found).not.toContain(titles[2]);
});
