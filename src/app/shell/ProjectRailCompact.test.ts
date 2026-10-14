import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PROJECT_RAIL_COMPACT_WIDTH,
  PROJECT_RAIL_NARROW_WIDTH,
} from "../../features/settings/model/appearance";

// Tailwind needs the container-query class written out, so the compact
// threshold lives in the markup as well. Keep both in step.
it("uses the shared compact threshold in the rail markup", () => {
  const needle = `@max-[${PROJECT_RAIL_COMPACT_WIDTH}px]/rail:`;
  const narrow = `@max-[${PROJECT_RAIL_NARROW_WIDTH}px]/rail:`;
  for (const file of ["ProjectRail.tsx", "RailAction.tsx", "SettingsRail.tsx"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(source).toContain(needle);
    expect(
      source
        .match(/@max-\[\d+px\]\/rail:/g)
        ?.every((c) => c.includes(needle) || c.includes(narrow)),
    ).toBe(true);
  }
});

it("drops shortcut hints at the shared narrow threshold", () => {
  const source = readFileSync(new URL("./RailAction.tsx", import.meta.url), "utf8");
  expect(source).toContain(`@max-[${PROJECT_RAIL_NARROW_WIDTH}px]/rail:hidden`);
});
