import { expect, it } from "vitest";
import { recentBriefingNotes } from "./briefing-sources";

it.each(["Pacific/Kiritimati", "America/Los_Angeles"])(
  "matches UTC note titles around UTC midnight in %s without renaming artifacts",
  (zone) => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      const now = Date.parse("2026-11-04T00:30:00Z");
      const notes = [
        {
          id: "today",
          title: "Old assistant name · 2026-11-04",
          body: "one",
          tags: ["assistant"],
          createdAt: 1,
          updatedAt: 3,
        },
        {
          id: "yesterday",
          title: "Assistant · 2026-11-03",
          body: "two",
          tags: ["assistant"],
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "old",
          title: "Assistant · 2026-11-02",
          body: "three",
          tags: ["assistant"],
          createdAt: 1,
          updatedAt: 1,
        },
      ];
      expect(recentBriefingNotes(notes, now).map((note) => note.id)).toEqual([
        "today",
        "yesterday",
      ]);
      expect(
        recentBriefingNotes(notes, Date.parse("2026-11-03T23:59:00Z")).map((note) => note.id),
      ).toEqual(["yesterday", "old"]);
      expect(
        recentBriefingNotes(notes, Date.parse("2026-11-04T00:01:00Z")).map((note) => note.id),
      ).toEqual(["today", "yesterday"]);
      expect(notes.map((note) => note.title)).toEqual([
        "Old assistant name · 2026-11-04",
        "Assistant · 2026-11-03",
        "Assistant · 2026-11-02",
      ]);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  },
);
