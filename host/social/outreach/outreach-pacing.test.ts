import { describe, expect, it } from "vitest";
import { paceCaps, nextUtcDay, nextUtcHour, utcDayKey, utcHourKey } from "./outreach-pacing";
import { enrollmentId, isPersonalWhatsApp } from "./outreach-sequences";
import { splitEmailTemplate } from "./outreach-input";

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 1, 9);
const pacing = (perDay: number, warmupDays: number) => ({
  pacing: { perHour: 50, perDay, warmupDays },
});

describe("paceCaps (warm-up)", () => {
  it("ramps the daily cap linearly over the warm-up days, never below 1", () => {
    expect(paceCaps(pacing(10, 5), START, START).perDay).toBe(2); // day 1 of 5
    expect(paceCaps(pacing(10, 5), START, START + 2 * DAY).perDay).toBe(6); // day 3 of 5
    expect(paceCaps(pacing(10, 5), START, START + 5 * DAY).perDay).toBe(10); // warm-up over
    expect(paceCaps(pacing(1, 5), START, START).perDay).toBe(1);
  });

  it("uses the configured caps with no warm-up or no recorded start", () => {
    expect(paceCaps(pacing(10, 0), START, START)).toEqual({ perHour: 50, perDay: 10 });
    expect(paceCaps(pacing(10, 5), undefined, START)).toEqual({ perHour: 50, perDay: 10 });
  });
});

describe("UTC keys and boundaries", () => {
  it("day and hour keys and the next boundaries are UTC", () => {
    const at = Date.UTC(2026, 10, 7, 12, 30);
    expect(utcDayKey(at)).toBe("2026-11-07");
    expect(utcHourKey(at)).toBe("2026-11-07T12");
    expect(nextUtcHour(at)).toBe(Date.UTC(2026, 10, 7, 13));
    expect(nextUtcDay(at)).toBe(Date.UTC(2026, 10, 8));
  });
});

describe("enrollment identity and channel rules", () => {
  it("the same person joins the same sequence under the same id, and another sequence gets another id", () => {
    expect(enrollmentId("seq-1", "p1")).toBe(enrollmentId("seq-1", "p1"));
    expect(enrollmentId("seq-1", "p1")).not.toBe(enrollmentId("seq-2", "p1"));
  });

  it("personal WhatsApp is the browser connection only", () => {
    expect(isPersonalWhatsApp({ platform: "whatsapp", connection: "browser" })).toBe(true);
    expect(isPersonalWhatsApp({ platform: "whatsapp", connection: "token" })).toBe(false);
    expect(isPersonalWhatsApp({ platform: "x", connection: "browser" })).toBe(false);
  });
});

describe("splitEmailTemplate", () => {
  it("reads a Subject line and the body after it", () => {
    expect(splitEmailTemplate("Subject: Hello\n\nLine one\nLine two")).toEqual({
      subject: "Hello",
      body: "Line one\nLine two",
    });
  });

  it("refuses a template without a body", () => {
    expect(() => splitEmailTemplate("Subject: Only")).toThrow("subject line and a body");
  });
});

describe("UTC pacing keys", () => {
  it("formats the UTC day and hour of a valid clock reading", () => {
    expect(utcDayKey(Date.UTC(2026, 10, 7, 12))).toBe("2026-11-07");
    expect(utcHourKey(Date.UTC(2026, 10, 7, 12))).toBe("2026-11-07T12");
  });

  it("refuses an invalid clock reading instead of keying a counter by a broken day", () => {
    expect(() => utcDayKey(Number.NaN)).toThrow(RangeError);
    expect(() => utcHourKey(Number.NaN)).toThrow(RangeError);
  });
});
