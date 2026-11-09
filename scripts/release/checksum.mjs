import assert from "node:assert/strict";

/** A single standard sha256sum record binds both digest and exact archive name. */
export function parseSha256Sum(text, filename) {
  assert(
    typeof text === "string" && text.length <= 1024,
    "Checksum record is missing or oversized",
  );
  assert(
    typeof filename === "string" && filename && !/[\\/\r\n\0]/.test(filename),
    "Expected a checksum basename",
  );
  const match = /^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/.exec(text);
  assert(match && match[2] === filename, "Checksum must name exactly the expected archive");
  return match[1];
}

export function formatSha256Sum(hash, filename) {
  const record = `${hash}  ${filename}\n`;
  assert.equal(parseSha256Sum(record, filename), hash, "Invalid checksum digest");
  return record;
}
