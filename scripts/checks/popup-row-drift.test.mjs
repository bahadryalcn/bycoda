import assert from "node:assert/strict";
import test from "node:test";
import { collectDefinitions, scanFile } from "./check-ui-drift.mjs";

const definitions = collectDefinitions(new Map([["src/styles/index.css", ":root { --x: 1; }"]]));

test("existing appearance rules reject frames on feature option and menu rows", () => {
  for (const role of ["option", "menuitem", "menuitemradio", "menuitemcheckbox"]) {
    for (const state of [
      "",
      ":hover",
      ":active",
      ":focus-visible",
      '[aria-selected="true"]',
      '[aria-disabled="true"]',
    ]) {
      for (const declaration of [
        "border: 1px solid var(--x)",
        "outline: 1px solid var(--x)",
        "box-shadow: inset 0 0 0 1px var(--x)",
      ]) {
        const findings = scanFile(
          "src/features/demo/Choices.module.css",
          `[role="${role}"]${state} { ${declaration}; }`,
          definitions,
        );
        assert.ok(
          findings.some(({ rule }) => rule === "surface-style" || rule === "interaction-state"),
          `${role}${state}: ${declaration}`,
        );
      }
    }
    for (const classes of ["border", "ring-1", "outline", "hover:ring-1", "aria-selected:border"]) {
      const findings = scanFile(
        "src/features/demo/Choices.tsx",
        `<Button role="${role}" className="${classes}" />`,
        definitions,
      );
      assert.ok(
        findings.some(({ rule }) => rule === "surface-style" || rule === "interaction-state"),
        `${role}: ${classes}`,
      );
    }
  }
});
