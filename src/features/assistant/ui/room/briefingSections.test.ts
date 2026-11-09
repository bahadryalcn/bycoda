import { expect, it } from "vitest";
import { briefingSections } from "./briefingSections";

it("splits the English Host briefing and leaves out the notes section", () => {
  const text = [
    "Good morning. 2 jobs are waiting for you.",
    "Your decisions:",
    "• Pick a database",
    "• Approve the plan",
    "In progress:",
    "• Refactor the sidebar",
    "Today and yesterday's notes:",
    "• Arif · 2026-11-07",
    "Some note details are unavailable.",
  ].join("\n");
  expect(briefingSections(text)).toEqual({
    lead: "Good morning. 2 jobs are waiting for you.",
    sections: [
      { label: "Your decisions", items: ["Pick a database", "Approve the plan"] },
      { label: "In progress", items: ["Refactor the sidebar"] },
    ],
    notes: ["Some note details are unavailable."],
  });
});

it("splits the Turkish Host briefing and drops its notes section", () => {
  const text = [
    "Günaydın. Bir iş senden bekliyor.",
    "Onaylar:",
    "• Komut onayı bekliyor",
    "Bugünün ve dünün notları:",
    "• Arif · 2026-11-07",
  ].join("\n");
  const parts = briefingSections(text);
  expect(parts.lead).toBe("Günaydın. Bir iş senden bekliyor.");
  expect(parts.sections).toEqual([{ label: "Onaylar", items: ["Komut onayı bekliyor"] }]);
  expect(parts.notes).toEqual([]);
});

it("keeps a greeting-only briefing as the lead", () => {
  expect(briefingSections("Good morning. Nothing needs you.")).toEqual({
    lead: "Good morning. Nothing needs you.",
    sections: [],
    notes: [],
  });
});

it("falls back to one paragraph for text that does not follow the Host shape", () => {
  for (const text of [
    "",
    "• orphan bullet\nsecond line",
    "Greeting\n• bullet before any label",
    "Greeting\nLabel:\n• item\nfoot one\nfoot two\nfoot three",
    "Greeting\nEmpty label:",
    "just\nsome\nrandom\ntext",
  ]) {
    expect(briefingSections(text)).toEqual({ lead: text.trim(), sections: [], notes: [] });
  }
});
