import { describe, expect, it, vi } from "vitest";
import { splitStdoutLines } from "./stdout-lines";

function collect(maxBytes?: number) {
  const lines: string[] = [];
  const onOverflow = vi.fn();
  const splitter = splitStdoutLines((line) => lines.push(line), onOverflow, maxBytes);
  return { lines, onOverflow, ...splitter };
}

describe("splitStdoutLines", () => {
  it("emits lines split across chunk boundaries", () => {
    const out = collect();
    out.push(Buffer.from('{"id":1,"res'));
    out.push(Buffer.from('ult":{}}\n{"id":2}\n'));
    expect(out.lines).toEqual(['{"id":1,"result":{}}', '{"id":2}']);
    expect(out.onOverflow).not.toHaveBeenCalled();
  });

  it("strips a trailing carriage return and flushes an unterminated last line on end", () => {
    const out = collect();
    out.push(Buffer.from("a\r\nb"));
    expect(out.lines).toEqual(["a"]);
    out.end();
    expect(out.lines).toEqual(["a", "b"]);
  });

  it("does not split a multi-byte character that spans chunks", () => {
    const out = collect();
    const bytes = Buffer.from("é\n", "utf8");
    out.push(bytes.subarray(0, 1));
    out.push(bytes.subarray(1));
    expect(out.lines).toEqual(["é"]);
  });

  it("accepts a line exactly at the cap", () => {
    const out = collect(8);
    out.push(Buffer.from("12345678\n"));
    expect(out.lines).toEqual(["12345678"]);
    expect(out.onOverflow).not.toHaveBeenCalled();
  });

  it("drops an oversized line within one chunk, reports it once, and keeps the next line", () => {
    const out = collect(8);
    out.push(Buffer.from("123456789\nok\n"));
    expect(out.lines).toEqual(["ok"]);
    expect(out.onOverflow).toHaveBeenCalledTimes(1);
  });

  it("drops an oversized line that arrives in many chunks without buffering it", () => {
    const out = collect(8);
    for (let i = 0; i < 1000; i++) out.push(Buffer.from("xxxx"));
    expect(out.onOverflow).toHaveBeenCalledTimes(1);
    out.push(Buffer.from("tail\nnext\n"));
    expect(out.lines).toEqual(["next"]);
    expect(out.onOverflow).toHaveBeenCalledTimes(1);
  });

  it("reports an oversized line that completes at a newline in a later chunk", () => {
    const out = collect(8);
    out.push(Buffer.from("123456"));
    out.push(Buffer.from("789\nafter\n"));
    expect(out.lines).toEqual(["after"]);
    expect(out.onOverflow).toHaveBeenCalledTimes(1);
  });

  it("discards an unterminated oversized line at end without emitting it", () => {
    const out = collect(8);
    out.push(Buffer.from("0123456789"));
    out.end();
    expect(out.lines).toEqual([]);
    expect(out.onOverflow).toHaveBeenCalledTimes(1);
  });
});
