import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #632: a row that holds density-scaled Buttons or fields must grow with the
// control-height tokens instead of pinning h-7/h-8, which Comfortable and Touch overflow.
const source = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
const fixedRowHeight = /className="[^"]*(?<![\w-])h-[6-9](?![\w.-])[^"]*"/;

describe("fixed-height rows with controls", () => {
  it.each([
    ["app/shell/UsageProviderChip.tsx"],
    ["features/sessions/ui/MessageQueue.tsx"],
    ["features/source-control/ui/BranchManagerDialog.tsx"],
  ])("%s sizes its control rows from the density tokens", (file) => {
    const text = source(file);
    expect(text).not.toMatch(fixedRowHeight);
    expect(text).toMatch(/min-h-\(--ui-control-height(-compact)?\)/);
  });

  it("keeps Compact heights: the field row follows the field token, button rows the compact one", () => {
    const branches = source("features/source-control/ui/BranchManagerDialog.tsx");
    expect(branches.match(/min-h-\(--ui-control-height\) items-center/g)).toHaveLength(2);
    const usage = source("app/shell/UsageProviderChip.tsx");
    expect(usage.match(/min-h-\(--ui-control-height-compact\) items-center/g)).toHaveLength(1);
    const queue = source("features/sessions/ui/MessageQueue.tsx");
    const queueRows = [...queue.matchAll(/className="([^"]*)"/g)].filter(([, value]) => {
      const classes = value!.split(/\s+/);
      return (
        classes.includes("min-h-(--ui-control-height-compact)") && classes.includes("items-center")
      );
    });
    expect(queueRows).toHaveLength(3);
  });
});
