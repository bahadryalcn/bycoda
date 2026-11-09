import { expect, it } from "vitest";
import { notePlainLines, timedNoteLine, todayNoteLines } from "./todayNotesLines";

it("strips markdown block markers and event markers", () => {
  expect(notePlainLines("## Head\n- one <!-- assistant-event:e1 -->\n* two\n\n")).toEqual([
    "Head",
    "one",
    "two",
  ]);
});

it("limits to three lines with the title on the first", () => {
  const lines = todayNoteLines([{ id: "n", title: "T", body: "a\nb\nc\nd" }]);
  expect(lines.map((line) => [line.title, line.text])).toEqual([
    ["T", "a"],
    ["", "b"],
    ["", "c"],
  ]);
});

it("splits a leading time off a line and drops the UTC suffix", () => {
  expect(timedNoteLine("10:15 UTC · Started the review")).toEqual({
    time: "10:15",
    text: "Started the review",
  });
  expect(timedNoteLine("Plain line · with a dot")).toEqual({ text: "Plain line · with a dot" });
});

it("gives timed note lines a time and strips the bullet and UTC", () => {
  const lines = todayNoteLines([
    { id: "n", title: "Arif · 2026-11-08", body: "- 09:05 UTC · Planned\n- 09:40 UTC · Shipped" },
  ]);
  expect(lines.map((line) => [line.title, line.time, line.text])).toEqual([
    ["Arif · 2026-11-08", "09:05", "Planned"],
    ["", "09:40", "Shipped"],
  ]);
});
