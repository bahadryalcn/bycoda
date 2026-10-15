import { expect, it } from "vitest";
import { collator, dateTimeFormat, relativeTimeFormat } from "./intl";
it("shares equivalent options and isolates locales, time zones and formatting modes", () => {
  const format = dateTimeFormat("tr", { hour: "numeric", timeZone: "UTC" });
  expect(dateTimeFormat("tr", { timeZone: "UTC", hour: "numeric" })).toBe(format);
  expect(dateTimeFormat("en", { hour: "numeric", timeZone: "UTC" })).not.toBe(format);
  expect(format.format(0)).toBe(
    new Intl.DateTimeFormat("tr", { hour: "numeric", timeZone: "UTC" }).format(0),
  );
  expect(relativeTimeFormat("tr", { numeric: "auto" }).format(-1, "day")).toBe("dün");
  expect(collator("en", { numeric: true }).compare("item2", "item10")).toBeLessThan(0);
});
