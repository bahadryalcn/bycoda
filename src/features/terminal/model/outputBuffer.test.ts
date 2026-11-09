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

it("admits only one xterm parse and acknowledges complete ordered bytes", () => {
  const writes: (string | Uint8Array)[] = [];
  const completions: (() => void)[] = [];
  const credits = [vi.fn(), vi.fn(), vi.fn()];
  const output = terminalOutputBuffer(
    (data, done) => {
      writes.push(data);
      completions.push(done!);
    },
    8,
    true,
  );
  output.setVisible(true);
  output.append("one", credits[0]);
  output.append("two", credits[1]);
  output.append("three", credits[2]);
  expect(writes).toEqual(["one"]);
  expect(credits[0]).not.toHaveBeenCalled();
  completions.shift()!();
  expect(writes).toEqual(["one", "two"]);
  completions.shift()!();
  completions.shift()!();
  expect(writes).toEqual(["one", "two", "three"]);
  for (const credit of credits) expect(credit).toHaveBeenCalledOnce();
});

it("withholds credits behind a hidden drain and releases all waiters exactly once on dispose", () => {
  const callbacks: (() => void)[] = [];
  const output = terminalOutputBuffer((_data, done) => callbacks.push(done!), 8, true);
  const retained = vi.fn(),
    draining = vi.fn(),
    queued = vi.fn();
  output.append("ab", retained);
  expect(retained).toHaveBeenCalledOnce();
  output.append("cd", draining);
  output.append("next", queued);
  expect(draining).not.toHaveBeenCalled();
  expect(queued).not.toHaveBeenCalled();
  output.dispose();
  callbacks[0]();
  expect(draining).toHaveBeenCalledOnce();
  expect(queued).toHaveBeenCalledOnce();
});
