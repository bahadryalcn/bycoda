import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TimePicker } from "../TimePicker";
import { DatePicker } from "../DatePicker";
import { DateTimePicker } from "../DateTimePicker";
import { DateRangePicker } from "../DateRangePicker";
import { DateTimeRangePicker } from "../DateTimeRangePicker";

const range = { start: new Date(2026, 10, 13, 8, 30), end: new Date(2026, 10, 14, 9) };
const common = {
  label: "Report period",
  hideLabel: true,
  description: "Choose the reporting period",
  onChange: () => {},
};
const pickers = [
  ["time", () => createElement(TimePicker, { ...common, value: "08:30" })],
  ["date", () => createElement(DatePicker, { ...common, value: "2026-11-13" })],
  ["datetime", () => createElement(DateTimePicker, { ...common, value: "2026-11-13T08:30" })],
  ["date range", () => createElement(DateRangePicker, { ...common, value: range })],
  ["datetime range", () => createElement(DateTimeRangePicker, { ...common, value: range })],
] as const;

it.each(pickers)("keeps the %s trigger named when its visible label is hidden", (_name, field) => {
  const html = renderToStaticMarkup(field());
  expect(html).not.toContain("<label");
  const trigger = html.match(/<button\b[^>]*aria-haspopup="dialog"[^>]*>/)?.[0];
  expect(trigger).toContain('aria-label="Report period"');
  const descriptions = trigger?.match(/aria-describedby="([^"]+)"/)?.[1].split(" ");
  expect(descriptions).toHaveLength(2);
  const value = [...html.matchAll(/<span\b[^>]*\bid="([^"]+)"[^>]*>([^<]+)<\/span>/g)].find(
    (match) => match[1] === descriptions?.[1],
  )?.[2];
  expect(value).toBeTruthy();
});
