import { afterEach, beforeEach, expect, it } from "vitest";
import { formatDate, setLanguagePreference, t } from "../../../shared/i18n";
import { sessionReminderPresets } from "./sessionReminderPresets";

// Friday morning: every snooze choice is still in the future.
const now = new Date(2026, 8, 11, 10, 30);
const clock = (date: Date) => formatDate(date, { hour: "numeric", minute: "2-digit" });

beforeEach(async () => {
  await setLanguagePreference("en");
});
afterEach(async () => {
  await setLanguagePreference("en");
});

it("labels each snooze choice with its scheduled clock time", () => {
  const items = sessionReminderPresets(t, formatDate, now);
  expect(items.map((item) => item.label)).toEqual([
    `In 1 hour (${clock(new Date(2026, 8, 11, 11, 30))})`,
    `In 3 hours (${clock(new Date(2026, 8, 11, 13, 30))})`,
    `This evening (${clock(new Date(2026, 8, 11, 18))})`,
    `Tomorrow (${clock(new Date(2026, 8, 12, 9))})`,
    `Next week (${formatDate(new Date(2026, 8, 14, 9), { weekday: "short", hour: "numeric", minute: "2-digit" })})`,
  ]);
});

it("keeps this evening disabled once 18:00 has passed", () => {
  const evening = (at: Date) =>
    sessionReminderPresets(t, formatDate, at).find((item) => item.id === "reminder:evening");
  expect(evening(now)?.disabled).toBe(false);
  expect(evening(new Date(2026, 8, 11, 18))?.disabled).toBe(true);
});

it("translates labels and places the locale's own clock format in them", async () => {
  await setLanguagePreference("de");
  const labels = sessionReminderPresets(t, formatDate, now).map((item) => item.label);
  expect(labels[0]).toBe(`In 1 Stunde (${clock(new Date(2026, 8, 11, 11, 30))})`);
  expect(labels[3]).toBe(`Morgen (${clock(new Date(2026, 8, 12, 9))})`);
  expect(labels[4]).toMatch(/^Nächste Woche \(.+\)$/);
});
