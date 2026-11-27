import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("session recovery dialog layout (#339)", () => {
  it("does not reach into Modal's private panel structure or subtract a chrome height", () => {
    const css = read("./session-recovery.css");
    expect(css).not.toContain("modal-panel");
    expect(css).not.toContain("110px");
  });

  it("lets the Modal body hand its height to the recovery list instead of scrolling itself", () => {
    const source = read("./SessionRecoveryPanel.tsx");
    const dialog = source.slice(source.indexOf("<Modal"), source.indexOf("</Modal>"));
    expect(dialog).toContain('scroll="none"');
    expect(dialog).toContain("fitViewport");
    expect(dialog).not.toContain("className=");
  });
});
