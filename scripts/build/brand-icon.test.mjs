import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderBrandIcon } from "./brand-icon.mjs";

test("shell vectors retain six separate optical drops and native-size strokes", async () => {
  const geometry = JSON.parse(
    await readFile(new URL("../../src/shared/lib/brandGeometry.json", import.meta.url), "utf8"),
  );
  for (const [tone, foreground] of [
    ["black", "#000000"],
    ["white", "#FFFFFF"],
  ]) {
    const svg = renderBrandIcon(geometry, 24, { foreground, background: "none" });
    assert.equal((svg.match(/data-tea-drop=/g) ?? []).length, 6);
    assert.equal((svg.match(new RegExp(`d="${geometry.smallDrop}"`, "g")) ?? []).length, 6);
    assert.ok(svg.includes(`d="${geometry.code}"`));
    assert.ok(svg.includes('width="24" height="24"'));
    assert.ok(svg.includes('fill="none"'));
    const strokes = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((match) => Number(match[1]));
    const scale = 20 / 74;
    assert.ok(strokes.every((stroke) => stroke * scale >= 0.8));
    assert.equal(
      await readFile(
        new URL(`../../public/brand/bycoda/mark-small-${tone}.svg`, import.meta.url),
        "utf8",
      ),
      svg,
    );
  }
});
