import assert from "node:assert/strict";
import test from "node:test";
import { measurePayloads, comparePayloadReports } from "./context-metrics.mjs";

const payload = (id, layer, serialized) => ({
  id,
  layer,
  source: "sanitized-test",
  serialization: "raw-utf8",
  serialized,
});

test("counts UTF-8 rather than characters and keeps context separate from transfers", () => {
  const report = measurePayloads([
    payload("prompt", "provider-context", "ğ🙂"),
    payload("tools", "mcp-context", '{"read":true}'),
    payload("thread", "thread-transfer", "ğ🙂"),
    payload("wire", "websocket-message", "abcdef"),
  ]);
  assert.deepEqual(report.totals, {
    "provider-context": 6,
    "mcp-context": 13,
    "thread-transfer": 6,
    "websocket-message": 6,
  });
  assert.equal(report.entries[0].sha256, report.entries[2].sha256);
  assert(!JSON.stringify(report).includes("ğ🙂"), "reports must not copy payload contents");
});

test("a larger context remains a positive byte delta without a budget escape hatch", () => {
  const before = measurePayloads([payload("prompt", "provider-context", "a")]);
  const after = measurePayloads([payload("prompt", "provider-context", "a".repeat(8000))]);
  assert.deepEqual(comparePayloadReports(before, after), [
    {
      id: "prompt",
      state: "comparable",
      previousUtf8Bytes: 1,
      currentUtf8Bytes: 8000,
      deltaUtf8Bytes: 7999,
    },
  ]);
  assert(!("pass" in after));
});

test("removed fixtures and changed measurement boundaries cannot look like savings", () => {
  const before = measurePayloads([
    payload("same", "provider-context", "aaaa"),
    payload("removed", "mcp-context", "xxx"),
  ]);
  const after = measurePayloads([
    payload("same", "thread-transfer", "a"),
    payload("new", "mcp-context", "x"),
  ]);
  const result = comparePayloadReports(before, after);
  assert.equal(result.find((entry) => entry.id === "same").deltaUtf8Bytes, null);
  assert.equal(result.find((entry) => entry.id === "same").state, "measurement-changed");
  assert.equal(result.find((entry) => entry.id === "removed").state, "removed");
  assert.equal(result.find((entry) => entry.id === "new").state, "added");
});

test("rejects ambiguous labels, duplicate IDs, and unserialized objects", () => {
  assert.throws(() => measurePayloads([payload("x", "tokens", "a")]));
  assert.throws(() => measurePayloads([payload("x", "mcp-context", {})]));
  assert.throws(() =>
    measurePayloads([payload("x", "mcp-context", "a"), payload("x", "mcp-context", "b")]),
  );
});
