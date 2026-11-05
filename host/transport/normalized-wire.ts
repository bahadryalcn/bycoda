/** Internal immutable-byte capture. No caller-supplied wire/text trust flag. */
declare const normalizedJsonBrand: unique symbol;
export type NormalizedJsonWire = { readonly [normalizedJsonBrand]: true };
type Capture = Readonly<{ serialized: string; wire: unknown; byteLength: number }>;
const captures = new WeakMap<NormalizedJsonWire, Capture>();
function retain(
  serialized: string,
  wire: unknown,
  byteLength = Buffer.byteLength(serialized),
): NormalizedJsonWire {
  const token = Object.freeze({}) as NormalizedJsonWire;
  captures.set(token, Object.freeze({ serialized, wire, byteLength }));
  return token;
}
export function readNormalizedJsonWire(token: NormalizedJsonWire): Capture {
  const capture = captures.get(token);
  if (!capture) throw new Error("Unknown normalized JSON capture.");
  return capture;
}
/** Runs the real toJSON boundary exactly once, then captures those actual bytes. */
export function normalizeJsonWire(value: unknown): NormalizedJsonWire {
  const serialized = JSON.stringify(value);
  return retain(serialized, JSON.parse(serialized));
}
/** Preserve toJSON's actual enclosing-field key for transformed typed results. */
export function normalizeJsonField(value: unknown, field: string): NormalizedJsonWire {
  const serialized = JSON.stringify({ [field]: value });
  const wire = JSON.parse(serialized) as Record<string, unknown>;
  if (!Object.hasOwn(wire, field)) throw new Error("JSON result field was omitted.");
  const prefix = `{${JSON.stringify(field)}:`;
  return retain(serialized.slice(prefix.length, -1), wire[field]);
}
/** Only a captured JSON value can supply a verbatim child. Metadata normalizes too. */
export function composeJsonWire(
  metadata: Record<string, unknown>,
  field: string,
  child: NormalizedJsonWire,
): NormalizedJsonWire {
  const header = readNormalizedJsonWire(normalizeJsonWire(metadata));
  if (
    !header.wire ||
    typeof header.wire !== "object" ||
    Array.isArray(header.wire) ||
    Object.hasOwn(header.wire, field)
  )
    throw new Error("Invalid normalized JSON envelope.");
  const content = readNormalizedJsonWire(child);
  const separator = header.serialized === "{}" ? "" : ",";
  const suffix = `${separator}${JSON.stringify(field)}:`;
  const serialized = `${header.serialized.slice(0, -1)}${suffix}${content.serialized}}`;
  return retain(
    serialized,
    { ...header.wire, [field]: content.wire },
    header.byteLength + Buffer.byteLength(suffix) + content.byteLength,
  );
}
/** Add normalized small metadata without walking/re-encoding captured content. */
export function extendJsonWire(
  object: NormalizedJsonWire,
  metadata: Record<string, unknown>,
): NormalizedJsonWire {
  const source = readNormalizedJsonWire(object);
  const header = readNormalizedJsonWire(normalizeJsonWire(metadata));
  if (
    !source.wire ||
    typeof source.wire !== "object" ||
    Array.isArray(source.wire) ||
    !header.wire ||
    typeof header.wire !== "object" ||
    Array.isArray(header.wire) ||
    Object.keys(header.wire).some((key) => Object.hasOwn(source.wire as object, key))
  )
    throw new Error("Invalid normalized JSON extension.");
  if (header.serialized === "{}") return object;
  const separator = source.serialized === "{}" ? "" : ",";
  const serialized = `${source.serialized.slice(0, -1)}${separator}${header.serialized.slice(1)}`;
  return retain(
    serialized,
    { ...source.wire, ...header.wire },
    source.byteLength + header.byteLength - 2 + separator.length,
  );
}
