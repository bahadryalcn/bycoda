/** Report exact serialized UTF-8 payloads. Never estimates tokens or imposes a budget. */
import { createHash } from "node:crypto";

const layers = ["provider-context", "mcp-context", "thread-transfer", "websocket-message"];

export function measurePayloads(payloads) {
  const identities = new Set();
  const entries = payloads.map(({ id, layer, source, serialization, serialized }) => {
    if (
      typeof id !== "string" ||
      !id ||
      identities.has(id) ||
      !layers.includes(layer) ||
      typeof source !== "string" ||
      !source ||
      typeof serialization !== "string" ||
      !serialization ||
      typeof serialized !== "string"
    )
      throw new TypeError(
        "Each payload requires a unique id, known layer, source, serialization and serialized string",
      );
    identities.add(id);
    return {
      id,
      layer,
      source,
      serialization,
      utf8Bytes: Buffer.byteLength(serialized, "utf8"),
      sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    };
  });
  return {
    schemaVersion: 1,
    measurement:
      "Exact UTF-8 bytes of the supplied serialized fixture; no tokens, quality score, compression, framing or live traffic inferred",
    totals: Object.fromEntries(
      layers.map((layer) => [
        layer,
        entries
          .filter((entry) => entry.layer === layer)
          .reduce((sum, entry) => sum + entry.utf8Bytes, 0),
      ]),
    ),
    entries,
  };
}

/** Missing/new payloads stay visible. Deliberately advisory: no configurable budget or pass flag. */
export function comparePayloadReports(previous, current) {
  const before = new Map(previous.entries.map((entry) => [entry.id, entry]));
  const after = new Map(current.entries.map((entry) => [entry.id, entry]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().map((id) => {
    const old = before.get(id);
    const next = after.get(id);
    return {
      id,
      state: !old
        ? "added"
        : !next
          ? "removed"
          : old.layer !== next.layer ||
              old.serialization !== next.serialization ||
              old.source !== next.source
            ? "measurement-changed"
            : "comparable",
      previousUtf8Bytes: old?.utf8Bytes ?? null,
      currentUtf8Bytes: next?.utf8Bytes ?? null,
      deltaUtf8Bytes:
        old &&
        next &&
        old.layer === next.layer &&
        old.serialization === next.serialization &&
        old.source === next.source
          ? next.utf8Bytes - old.utf8Bytes
          : null,
    };
  });
}
