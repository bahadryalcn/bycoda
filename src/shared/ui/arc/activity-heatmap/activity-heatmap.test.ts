import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ActivityHeatmap } from "./activity-heatmap";

const days = [{ date: "2025-01-01", count: 2 }];
const base = { days, label: "Contributions in 2025", period: "2025" };

it("names the level buttons group with the supplied localized label", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityHeatmap, { ...base, legendLabel: "Güne seviyeye göre vurgula" }),
  );
  expect(html).toContain('aria-label="Güne seviyeye göre vurgula"');
  expect(html).not.toContain('aria-label="Highlight days by level"');
});

it("keeps the English legend name when no label is supplied", () => {
  const html = renderToStaticMarkup(createElement(ActivityHeatmap, base));
  expect(html).toContain('aria-label="Highlight days by level"');
});

it("ships the legend name in every app locale", () => {
  for (const locale of ["de", "en", "es", "fr", "ja", "pt", "tr", "zh-CN"]) {
    const dictionary = JSON.parse(
      readFileSync(`src/shared/i18n/locales/${locale}.json`, "utf8"),
    ) as Record<string, string>;
    expect(dictionary["Highlight days by level"], locale).toBeTruthy();
  }
});
