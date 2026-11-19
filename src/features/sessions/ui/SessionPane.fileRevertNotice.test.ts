import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Regression for #291: the revert-files result notice must be dismissible. Dismissing clears only
// the displayed notice; the output stays rendered until then, and the retry guard result is kept.
const pane = readFileSync(new URL("./SessionPane.tsx", import.meta.url), "utf8");
const rewind = readFileSync(new URL("./useMessageRewind.ts", import.meta.url), "utf8");

it("wires the revert-files Alert's dismiss to the hook's clear action", () => {
  const start = pane.indexOf("{fileRevertNotice ? (");
  const alert = pane.slice(start, pane.indexOf("data-session-files-revert-result", start));
  expect(alert).toContain("onDismiss={dismissFileRevertNotice}");
  expect(pane).toContain("    dismissFileRevertNotice,\n");
});

it("clears only the displayed notice, not the remembered revert result", () => {
  expect(rewind).toContain("const dismissFileRevertNotice = () => setFileRevertNotice(null);");
  expect(rewind).toContain("    dismissFileRevertNotice,\n");
  const line = rewind.split("\n").find((text) => text.includes("const dismissFileRevertNotice"));
  expect(line).not.toContain("fileRevertResult");
});

it("keeps the reverted and skipped output in the notice body", () => {
  expect(pane).toContain("{t(\"Reverted files: {p0}\", {");
  expect(pane).toContain("{t(\"Skipped files: {p0}\", {");
});
