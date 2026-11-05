import { expect, it, vi } from "vitest";
import { OutputBuffer } from "./output-buffer";

it("matches retained string tails and ranged reads across page/ring boundaries", () => {
  for (const capacity of [1, 5, 4096, 4101, 8192]) {
    const output = new OutputBuffer(capacity);
    let expected = "";
    for (const chunk of [
      "",
      "\u001b[31m",
      "中文🚀",
      "x".repeat(4100),
      "z",
      "y".repeat(9000),
      "\r\nend",
    ]) {
      output.append(chunk);
      expected = (expected + chunk).slice(-capacity);
      expect(output.length).toBe(expected.length);
      expect(output.slice()).toBe(expected);
      for (const [start, end] of [
        [0, 3],
        [2, 4098],
        [-4, -1],
        [5, 2],
      ])
        expect(output.slice(start, end)).toBe(expected.slice(start, end));
    }
  }
});

it("preserves exact UTF-16 units including split surrogate and ANSI boundaries", () => {
  const output = new OutputBuffer(9);
  const chunks = ["discard", "\ud83d", "\ude80", "\u001b[", "31m", "é", "\r"];
  let expected = "";
  for (const chunk of chunks) {
    output.append(chunk);
    expected = (expected + chunk).slice(-9);
    expect(output.slice()).toBe(expected);
    for (let index = 0; index < expected.length; index++)
      expect(output.slice(index, index + 1)).toBe(expected.slice(index, index + 1));
  }
});

it("tiny appends copy only new retained units and never materialize prior output", () => {
  const output = new OutputBuffer(512 * 1024);
  output.append("x".repeat(512 * 1024));
  const units = vi.spyOn(String.prototype, "charCodeAt");
  const materialize = vi.spyOn(String, "fromCharCode");
  try {
    for (let index = 0; index < 1000; index++) output.append("z");
    expect(units).toHaveBeenCalledTimes(1000);
    expect(materialize).not.toHaveBeenCalled();
  } finally {
    units.mockRestore();
    materialize.mockRestore();
  }
  expect(output.slice(-1001)).toBe("x" + "z".repeat(1000));
});
