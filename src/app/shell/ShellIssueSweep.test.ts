import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("translates the shell labels and includes their keys in every desktop locale", () => {
  const labels = [
    ["TitleBar", ["Scroll tabs left", "Scroll tabs right", "Tab actions for {p0}"]],
    ["ProjectRail", ["No projects yet"]],
    ["UsageFooter", ["Provider usage", "Terminals", "Session", "Could not complete sign-in"]],
    ["UsageProviderChip", ["Could not complete sign-in"]],
    ["NavigationBoundary", ["Loading {p0}…"]],
    ["SidebarUpdate", ["Remind me tomorrow"]],
  ] as const;

  for (const [file, keys] of labels) {
    const component = source(`./${file}.tsx`);
    for (const key of keys) expect(component).toContain(`t("${key}"`);
  }

  for (const locale of ["de", "en", "es", "fr", "ja", "pt", "tr", "zh-CN"]) {
    const catalog = JSON.parse(source(`../../shared/i18n/locales/${locale}.json`));
    for (const [, keys] of labels) {
      for (const key of keys) expect(catalog[key], `${locale}: ${key}`).toBeTruthy();
    }
  }
});

it("uses distinct icons for opening, returning, and pending window moves", () => {
  expect(source("./ToolNavigation.tsx")).toMatch(
    /label=\{t\("Open in new window"\)\}[\s\S]*?<ExternalLink\b/,
  );
  const titleBar = source("./TitleBar.tsx");
  expect(titleBar).toMatch(/label=\{t\("Return to main window"\)\}[\s\S]*?<Undo2\b/);
  expect(titleBar).toMatch(/tab\.pendingWindowMove \|\| tab\.movingWindow[\s\S]*?<Clock\b/);
});

it("keeps the update notice wrapper visible in the compact project rail", () => {
  const wrapper = source("./ProjectRail.tsx").match(
    /<div className="([^"]+)"\s*>\s*<SidebarUpdateFooter\s+noticesOnly/,
  );
  expect(wrapper?.[1]).toBeDefined();
  expect(wrapper?.[1]).not.toContain("hidden");
});
