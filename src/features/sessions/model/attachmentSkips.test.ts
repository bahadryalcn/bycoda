import { describe, expect, it } from "vitest";
import { collectSkippedAttachments, skippedAttachmentNotice } from "./attachmentSkips";

describe("skippedAttachmentNotice", () => {
  it("says nothing when no file was skipped", () => {
    expect(skippedAttachmentNotice([])).toBeNull();
  });

  it("names each skipped file with its own reason and the real size limit", () => {
    expect(
      skippedAttachmentNotice([
        { name: "huge.mov", reason: "too-large" },
        { name: "broken.txt", reason: "unreadable" },
      ]),
    ).toBe(
      "huge.mov is larger than 20 MB and was not attached. broken.txt could not be read and was not attached.",
    );
  });

  it("names the first three files and counts the rest", () => {
    const skipped = ["a", "b", "c", "d", "e"].map((name) => ({
      name: `${name}.bin`,
      reason: "too-large" as const,
    }));
    const notice = skippedAttachmentNotice(skipped)!;
    expect(notice).toContain("a.bin");
    expect(notice).toContain("c.bin");
    expect(notice).not.toContain("d.bin");
    expect(notice.endsWith("2 more files were not attached.")).toBe(true);
  });

  it("truncates a very long file name", () => {
    const notice = skippedAttachmentNotice([
      { name: `${"x".repeat(200)}.zip`, reason: "too-large" },
    ])!;
    expect(notice.length).toBeLessThan(120);
  });
});

describe("collectSkippedAttachments", () => {
  it("joins the skips of several reads into one notice", () => {
    const skips = collectSkippedAttachments();
    skips.onSkipped([{ name: "one.bin", reason: "too-large" }]);
    skips.onSkipped([{ name: "two.bin", reason: "unreadable" }]);
    expect(skips.notice()).toContain("one.bin");
    expect(skips.notice()).toContain("two.bin");
  });

  it("has no notice before anything is skipped", () => {
    expect(collectSkippedAttachments().notice()).toBeNull();
  });
});
