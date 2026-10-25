import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProcessJson } from "../../host/parse-process-json.mjs";

test("preserves raw control bytes inside OS process JSON strings", () => {
  const command = `node.exe title${String.fromCharCode(7)} line\nnext\tcolumn`;
  const raw = `[{"pid":42,"command":"node.exe title${String.fromCharCode(7)} line\nnext\tcolumn"}]`;
  assert.equal(parseProcessJson(raw)[0].command, command);
});

test("retains escaped quotes, backslashes, unicode and structural whitespace", () => {
  const value = [{ command: 'node.exe "C:\\a\\b.js" \\u0007 Ελληνικά' }];
  assert.deepEqual(parseProcessJson(`\uFEFF${JSON.stringify(value, null, 2)}\n`), value);
});

test("does not repair malformed process identities or JSON structure", () => {
  assert.throws(() => parseProcessJson('[{"pid":42,}]'), SyntaxError);
  assert.throws(() => parseProcessJson(`[{"pid":42}]${String.fromCharCode(7)}`), SyntaxError);
  assert.throws(() => parseProcessJson(`{"command":"bad\\${String.fromCharCode(7)}"}`), SyntaxError);
});
