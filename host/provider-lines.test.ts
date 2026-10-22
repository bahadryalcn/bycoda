import { expect, it, vi } from "vitest";
import { ProviderLines, PROVIDER_STDOUT_LINE_BYTES } from "./provider-lines";

it("delivers image history larger than the former 8 MiB limit intact", () => {
  const line = JSON.stringify({ id: 2, result: "a".repeat(9 * 1024 * 1024) });
  const delivered: string[] = [];
  const overflow = vi.fn();
  const lines = new ProviderLines(PROVIDER_STDOUT_LINE_BYTES, (l) => delivered.push(l), overflow);
  for (let i = 0; i < line.length; i += 65536) lines.push(line.slice(i, i + 65536));
  expect(delivered).toEqual([]);
  lines.push('\n{"id":3}\n');
  expect(delivered).toEqual([line, '{"id":3}']);
  expect(overflow).not.toHaveBeenCalled();
});

it("handles CRLF, empty lines and a final unterminated frame", () => {
  const delivered: string[] = [];
  const lines = new ProviderLines(20, (l) => delivered.push(l), vi.fn());
  lines.push("one\r");
  lines.push("\n\ntwo\nlast");
  lines.end();
  lines.end();
  expect(delivered).toEqual(["one", "", "two", "last"]);
});

it.each([true, false])("rejects an oversized UTF-8 frame once, newline=%s", (newline) => {
  const delivered = vi.fn();
  const overflow = vi.fn();
  const lines = new ProviderLines(6, delivered, overflow);
  lines.push("ok\néé");
  lines.push(`éé${newline ? "\n" : ""}`);
  lines.push("discard\n");
  lines.end();
  expect(delivered.mock.calls).toEqual([["ok"]]);
  expect(overflow).toHaveBeenCalledOnce();
});

it("accepts the exact byte limit and resets it between frames", () => {
  const delivered = vi.fn();
  const overflow = vi.fn();
  const lines = new ProviderLines(4, delivered, overflow);
  lines.push("éé\néé\n");
  expect(delivered.mock.calls).toEqual([["éé"], ["éé"]]);
  expect(overflow).not.toHaveBeenCalled();
});
