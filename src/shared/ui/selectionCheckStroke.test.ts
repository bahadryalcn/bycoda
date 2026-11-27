import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/shared/ui/arc/context-menu/native-context-menu.tsx",
  "src/shared/ui/picker/PickerChoice.tsx",
  "src/shared/ui/arc/inline-edit/inline-edit.tsx",
  "src/app/shell/SessionFolderRows.tsx",
  "src/features/source-control/ui/BranchManagerDialog.tsx",
];

describe("selection check strokes", () => {
  it.each(files)("%s leaves the Check glyph at the shared stroke weight", (file) => {
    const source = readFileSync(file, "utf8");
    const heavy = source.match(/<Check\b[^>]*strokeWidth=\{(?:2|2\.25|3)\}/g);
    expect(heavy).toBeNull();
  });
});
