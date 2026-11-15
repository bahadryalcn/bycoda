import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { archetypes, fixtureFile, schemes, widths } from "./ui-acceptance-matrix.mjs";

test("every archetype names an existing browser fixture and a known archetype", () => {
  const kinds = new Set([
    "collection",
    "list and detail",
    "settings",
    "panel with toolbar",
    "dialog or sheet form",
    "state pane",
  ]);
  const names = new Set();
  for (const [name, route, kind] of archetypes) {
    assert.equal(names.has(name), false, `duplicate ${name}`);
    names.add(name);
    assert.ok(existsSync(fixtureFile(route)), `${name}: missing fixture ${route}`);
    assert.ok(kinds.has(kind), `${name}: unknown archetype ${kind}`);
  }
});

test("the matrix covers both themes at both widths", () => {
  assert.deepEqual(widths, [1280, 800]);
  assert.deepEqual([...schemes].sort(), ["dark", "light"]);
});
