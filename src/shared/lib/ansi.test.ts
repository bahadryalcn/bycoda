import { describe, expect, it } from "vitest";
import { parseAnsi, stripAnsi } from "./ansi";

describe("parseAnsi", () => {
  it("returns plain text untouched", () => {
    expect(parseAnsi("hello\n\tworld")).toEqual([{ text: "hello\n\tworld", style: {} }]);
    expect(parseAnsi("")).toEqual([]);
  });

  it("turns Vite-style color escapes into styled runs", () => {
    const text =
      "\u001b[2m02:15:29\u001b[22m \u001b[36m\u001b[1m[vite]\u001b[22m\u001b[39m hmr update";
    expect(parseAnsi(text)).toEqual([
      { text: "02:15:29", style: { dim: true } },
      { text: " ", style: { bold: undefined, dim: undefined } },
      { text: "[vite]", style: { bold: true, dim: undefined, fg: 6 } },
      { text: " hmr update", style: { bold: undefined, dim: undefined, fg: undefined } },
    ]);
  });

  it("maps bright, background and 256-color codes and resets", () => {
    const [bright, bg, indexed, wide, reset] = parseAnsi(
      "\u001b[91ma\u001b[0;44mb\u001b[38;5;2mc\u001b[38;2;1;2;3md\u001b[me",
    );
    expect(bright.style.fg).toBe(9);
    expect(bg.style).toEqual({ bg: 4 });
    expect(indexed.style.fg).toBe(2);
    expect(wide.style.fg).toBeUndefined();
    expect(reset).toEqual({ text: "e", style: {} });
  });

  it("drops cursor, title and stray control sequences", () => {
    expect(stripAnsi("\u001b]0;title\u0007\u001b[2K\u001b[1Gready\u0008")).toBe("ready");
  });

  it("reads lossy captures whose escape byte became U+FFFD", () => {
    expect(parseAnsi("�[32mok�[39m")).toEqual([{ text: "ok", style: { fg: 2 } }]);
  });

  it("keeps carriage-return progress lines readable", () => {
    expect(stripAnsi("10%\r20%\r\ndone")).toBe("10%\n20%\ndone");
  });
});
