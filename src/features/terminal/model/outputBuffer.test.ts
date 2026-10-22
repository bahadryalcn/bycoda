import { expect, it, vi } from "vitest";
import { terminalOutputBuffer } from "./outputBuffer";
it("defers hidden UTF-8 and ANSI chunks, flushes in order and writes visible output immediately", () => {
  const write = vi.fn();
  const output = terminalOutputBuffer(write);
  output.append(new Uint8Array([0xe2, 0x82]));
  output.append(new Uint8Array([0xac, 0x1b, 0x5b]));
  output.append("0m");
  expect(write).not.toHaveBeenCalled();
  output.setVisible(true);
  expect(write.mock.calls.map(([data]) => data)).toEqual([
    new Uint8Array([0xe2, 0x82, 0xac, 0x1b, 0x5b]),
    "0m",
  ]);
  output.append("visible");
  expect(write).toHaveBeenLastCalledWith("visible");
  output.setVisible(false);
  output.append("discard on disposal");
  output.dispose();
  output.setVisible(true);
  expect(write).toHaveBeenCalledTimes(3);
});
it("bounds hidden retention without discarding bytes", () => {
  const write = vi.fn();
  const output = terminalOutputBuffer(write, 8);
  output.append("ab");
  output.append("cd");
  expect(write).toHaveBeenCalledWith("abcd");
  output.append("ef");
  output.setVisible(true);
  expect(write).toHaveBeenLastCalledWith("ef");
});
