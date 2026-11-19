import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Source regressions for the content calendar layout (#1058). They read the stylesheet and the
 * component as text: the narrow agenda is a CSS decision, and the keyboard and schedule-action
 * contract is kept by the component's markup, which these checks pin down.
 */
const dir = "src/features/social/ui/content";
const css = readFileSync(`${dir}/content.css`, "utf8");
const component = readFileSync(`${dir}/ContentCalendar.tsx`, "utf8");
const narrow = css.match(/@container content-calendar \(max-width:\s*40rem\) \{([\s\S]*?)\n\}/);

it("declares the calendar root once as the named inline-size container", () => {
  expect(css.match(/container:\s*content-calendar\s*\/\s*inline-size;/g)).toHaveLength(1);
  expect(css).toMatch(/\.content-calendar \{\s*container: content-calendar \/ inline-size;/);
});

it("keeps the seven-column grid as the default for month and wide panes", () => {
  expect(css).toMatch(
    /\.content-calendar-weekdays,\s*\.content-calendar-grid \{\s*display: grid;\s*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\);/,
  );
});

it("stacks week days into one column inside the narrow container query", () => {
  expect(narrow).not.toBeNull();
  expect(narrow![1]).toMatch(
    /\.content-calendar\[data-view="week"\] \.content-calendar-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
});

it("drops the empty-day minimum height only in the stacked week agenda", () => {
  expect(narrow![1]).toMatch(
    /\.content-calendar\[data-view="week"\] \.content-day \{\s*min-height: 0;/,
  );
  // The base day rule keeps its 9rem minimum for the wide grid.
  expect(css).toMatch(/\.content-day \{[^}]*min-height: 9rem;/);
});

it("turns day hairlines into row rules in the stacked agenda", () => {
  expect(narrow![1]).toMatch(
    /\.content-day\[data-surface-frame\]\[data-surface-edge\] \{\s*border-width: 0;\s*border-block-start-width: 1px;/,
  );
});

it("lays the day header (weekday, number) out on one line in each agenda row", () => {
  expect(narrow![1]).toMatch(
    /\.content-day-title \{\s*flex-direction: row;\s*align-items: baseline;/,
  );
});

it("does not query the window for the calendar layout", () => {
  expect(css).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*\.content-(calendar|day)/);
});

it("keeps each post a real button and each day's schedule action reachable", () => {
  expect(component).toContain('variant="item"');
  expect(component).toContain('className="content-entry"');
  expect(component).toContain("onClick={() => onOpen(entry.campaignId)}");
  expect(component).toContain('className="content-day-add"');
  expect(component).toContain('label={t("New post on {p0}"');
  expect(component).toContain("onClick={() => onPickDay(startOfDay(day))}");
  expect(component).toContain('className="sr-only"');
});

it("exposes day cells as list items, not region landmarks", () => {
  expect(component).not.toContain("<section");
  expect(component).not.toContain("aria-label={formatDate(day");
  expect(component).toContain('role="list"');
  expect(component).toContain('role="listitem"');
});
