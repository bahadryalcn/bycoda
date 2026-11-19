// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it.each([
  ["./UsageProviderChip.tsx", "compact", 2],
  ["../../features/sessions/ui/MessageQueue.tsx", "compact", 3],
  ["../../features/source-control/ui/BranchManagerDialog.tsx", "standard", 2],
])("lets the control rows in %s grow with their controls", (path, height, rowCount) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const token = height === "compact" ? "--ui-control-height-compact" : "--ui-control-height";
  expect(source.split(`min-h-(${token})`)).toHaveLength(rowCount + 1);
  expect(source).not.toMatch(/className="[^"]*\bflex h-[78] items-center/);
});
