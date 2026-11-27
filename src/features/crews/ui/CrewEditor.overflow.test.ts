import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("shows the unfinished-additions note in full instead of truncating it behind a tooltip", () => {
  const editor = readFileSync(new URL("./CrewEditor.tsx", import.meta.url), "utf8");
  const table = readFileSync(new URL("./CrewMemberTable.tsx", import.meta.url), "utf8");
  const note = "Unfinished additions are kept until you add or discard them.";

  expect(editor).toContain(`t("${note}")`);
  expect(table).toMatch(/unfinishedNote \? <Text as="p">\{unfinishedNote\}<\/Text>/);
  expect(table).not.toMatch(/<OverflowTooltip[^>]*>\s*<Text[^>]*>\{unfinishedNote\}/);
});
