import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("makes the truncated unfinished-additions note available on hover and keyboard focus", () => {
  const source = readFileSync(new URL("./CrewEditor.tsx", import.meta.url), "utf8");
  const note = "Unfinished additions are kept until you add or discard them.";
  const tooltip = [...source.matchAll(/<OverflowTooltip\b([\s\S]*?)<\/OverflowTooltip>/g)].find(
    ([, content]) => content.includes(`label={t("${note}")}`),
  );

  expect(tooltip?.[1]).toMatch(/<Text\b[^>]*\btruncate\b[^>]*\btabIndex=\{0\}/);
  expect(tooltip?.[1]).toContain(`{t("${note}")}`);
});
