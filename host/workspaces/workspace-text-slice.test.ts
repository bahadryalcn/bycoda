import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseTextSliceRequest,
  readTextSlice,
  TEXT_FILE_CHANGED,
  type TextSlice,
  type TextSliceStamp,
} from "./workspace-text-slice";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "text-slice-"));
  path = join(dir, "big.log");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stampOf = (slice: TextSlice): TextSliceStamp => ({
  size: slice.size,
  modifiedUs: slice.modifiedUs,
});

/** Pages through the whole file as the viewer does: each page starts at the previous `end`. */
async function readAll(content: string | Buffer) {
  await writeFile(path, content);
  let text = "";
  const pages: TextSlice[] = [];
  let offset = 0;
  let expected: TextSliceStamp | null = null;
  for (;;) {
    const page = await readTextSlice(path, offset, expected);
    expected ??= stampOf(page);
    expect(page.offset).toBe(offset);
    text += page.text;
    pages.push(page);
    if (page.end >= page.size) return { text, pages };
    expect(page.end).toBeGreaterThan(page.offset);
    offset = page.end;
  }
}

describe("readTextSlice", () => {
  it("cuts a page at the last line break inside the page size", async () => {
    const line1 = "a".repeat(600_000) + "\n";
    const line2 = "b".repeat(600_000) + "\n";
    await writeFile(path, line1 + line2);
    const first = await readTextSlice(path, 0, null);
    expect(first.text).toBe(line1);
    expect([first.offset, first.end]).toEqual([0, line1.length]);
    const second = await readTextSlice(path, first.end, stampOf(first));
    expect([second.text, second.end]).toEqual([line2, line1.length + line2.length]);
  });

  it("returns an empty page past the end instead of failing", async () => {
    await writeFile(path, "abc\n");
    const past = await readTextSlice(path, 99, null);
    expect([past.text, past.offset, past.end]).toEqual(["", 4, 4]);
  });

  it("continues a line longer than a page from the exact byte it stopped at", async () => {
    const content = "x".repeat(2 * 1024 * 1024 + 7) + "\nshort\n";
    const { text, pages } = await readAll(content);
    expect(text).toBe(content);
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) expect(page.end - page.offset).toBeLessThanOrEqual(1024 * 1024);
  });

  it("never splits a multibyte character across pages", async () => {
    // 2-, 3- and 4-byte characters placed so that a page boundary falls inside one of them.
    const line = "é".repeat(600_000) + "€😀\n";
    const { text, pages } = await readAll(line.repeat(2));
    expect(text).toBe(line.repeat(2));
    for (const page of pages) expect(page.text).not.toContain("�");
  });

  it("keeps invalid bytes in place, decoded lossily", async () => {
    const content = Buffer.concat([Buffer.from("ab\xFFcd", "latin1"), Buffer.from("€ef")]);
    const { text } = await readAll(content);
    expect(text).toBe(content.toString("utf8"));
  });

  it("keeps a leading byte-order mark", async () => {
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("line\n")]));
    const page = await readTextSlice(path, 0, null);
    expect(page.text.charCodeAt(0)).toBe(0xfeff);
  });

  it("refuses a file that changed between pages", async () => {
    await writeFile(path, "aaaa\nbbbb\ncccc\ndddd\n");
    const first = await readTextSlice(path, 0, null);
    const stamp = stampOf(first);
    // A small file fits one page, so the second page starts at a fixed line boundary instead.
    const second = "aaaa\nbbbb\n".length;
    expect((await readTextSlice(path, second, stamp)).text).toBe("cccc\ndddd\n");

    await writeFile(path, "aaaa\nbbbb\ncccc\ndddd\neeee\n");
    await expect(readTextSlice(path, second, stamp)).rejects.toThrow(TEXT_FILE_CHANGED);

    await writeFile(path, "aa\n");
    await expect(readTextSlice(path, second, stamp)).rejects.toThrow(TEXT_FILE_CHANGED);
  });

  it("refuses binary content", async () => {
    await writeFile(path, Buffer.from([0x61, 0x00, 0x62]));
    await expect(readTextSlice(path, 0, null)).rejects.toThrow("Binary files cannot be previewed.");
  });

  it("refuses a folder", async () => {
    await expect(readTextSlice(dir, 0, null)).rejects.toThrow();
  });
});

describe("parseTextSliceRequest", () => {
  it("accepts an offset with or without a stamp", () => {
    expect(parseTextSliceRequest(0, null)).toEqual({ offset: 0, expected: null });
    expect(parseTextSliceRequest(12, { size: 40, modifiedUs: 9 })).toEqual({
      offset: 12,
      expected: { size: 40, modifiedUs: 9 },
    });
  });

  it("rejects a malformed offset or stamp", () => {
    expect(() => parseTextSliceRequest(-1, null)).toThrow("Invalid file slice request");
    expect(() => parseTextSliceRequest(1.5, null)).toThrow("Invalid file slice request");
    expect(() => parseTextSliceRequest(0, { size: "40", modifiedUs: 9 })).toThrow(
      "Invalid file slice request",
    );
  });
});
