import { createHash } from "node:crypto";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CHUNK_BYTES = 4096;
export const NATIVE_BUFFER_TEMPLATE_DESCRIPTOR_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 1024 * 1024;
const MAX_SLOTS = 200_000;
const hex = /^[a-f0-9]{64}$/;
const variableString =
  /^"(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})"$/;
const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const corrupt = () => new Error("Native buffer shared template is unavailable or corrupt");

export interface NativeBufferTemplateReceipt {
  version: 1;
  templateDigest: string;
  templateBytes: number;
  slots: number;
  replacements: string;
  replacementBytes: number;
  replacementDigest: string;
}
export interface PreparedNativeBufferTemplate {
  receipt: NativeBufferTemplateReceipt;
  template: Buffer;
}

/** This is a lossless byte factorization, not JSON regeneration. The caller has
 * already validated the raw JSON. Unsupported expansion falls back to v1. */
export function prepareNativeBufferTemplate(
  raw: Buffer,
  maximum: number,
  kind: "report" | "catalog" = "report",
): PreparedNativeBufferTemplate | null {
  if (raw.length > maximum || raw.includes(0)) return null;
  // parseStored accepts a leading UTF-8 BOM. Preserve it as an original static
  // byte prefix rather than letting TextDecoder silently discard that prefix.
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  if (!Buffer.from(text).equals(raw)) return null;
  const parts: string[] = [],
    tokens: string[] = [],
    containers: { name: string | null }[] = [];
  let property: string | null = null;
  let cursor = 0,
    staticStart = 0,
    tokenBytes = 2;
  while (cursor < text.length) {
    const start = cursor;
    let extracted = false;
    if (text[cursor] === '"') {
      cursor++;
      while (cursor < text.length) {
        if (text[cursor] === "\\") cursor += 2;
        else if (text[cursor++] === '"') break;
      }
      const token = text.slice(start, cursor);
      let following = cursor;
      while (/\s/.test(text[following] ?? "") && following < text.length) following++;
      if (text[following] === ":") property = JSON.parse(token) as string;
      else {
        // Stable store/window UUIDs and Native body digests belong in shared
        // static bytes. Only nonces and the Host catalog source digest vary on
        // every ordinary heartbeat. Never inspect property-like path text.
        extracted =
          variableString.test(token) &&
          (property === "reportNonce" ||
            (kind === "catalog" &&
              property === "snapshotDigest" &&
              containers.at(-1)?.name === "source"));
      }
    } else if (text[cursor] === "-" || /\d/.test(text[cursor])) {
      while (cursor < text.length && /[\deE.+-]/.test(text[cursor])) cursor++;
      extracted = number.test(text.slice(start, cursor));
    } else {
      if (text[cursor] === "{" || text[cursor] === "[") {
        containers.push({ name: property });
        property = null;
      } else if (text[cursor] === "}" || text[cursor] === "]") {
        containers.pop();
        property = null;
      } else if (text[cursor] === ",") property = null;
      cursor++;
    }
    if (!extracted) continue;
    const token = text.slice(start, cursor);
    tokenBytes += Buffer.byteLength(JSON.stringify(token)) + 1;
    if (tokenBytes > MAX_TOKEN_BYTES || tokens.length >= MAX_SLOTS) return null;
    parts.push(text.slice(staticStart, start), "\0");
    tokens.push(token);
    staticStart = cursor;
  }
  parts.push(text.slice(staticStart));
  const template = Buffer.from(parts.join("")),
    replacement = Buffer.from(JSON.stringify(tokens)),
    compressed = deflateRawSync(replacement);
  if (compressed.length > MAX_COMPRESSED_BYTES) return null;
  return {
    template,
    receipt: {
      version: 1,
      templateDigest: sha(template),
      templateBytes: template.length,
      slots: tokens.length,
      replacements: compressed.toString("base64"),
      replacementBytes: replacement.length,
      replacementDigest: sha(replacement),
    },
  };
}

/** Shared static objects are immutable; per-version receipts remain append-only.
 * Neither this codec nor content identity grants source/actor qualification. */
export function createNativeBufferTemplates(deps: {
  directory: string;
  read(path: string, maximum: number): Promise<Buffer | null>;
  immutable(path: string, bytes: Buffer | string): Promise<void>;
}) {
  const descriptorPath = (digest: string) => join(deps.directory, "templates", `${digest}.json`);
  return {
    async persist(prepared: PreparedNativeBufferTemplate) {
      const chunks: { digest: string; byteLength: number }[] = [];
      for (let offset = 0; offset < prepared.template.length; offset += CHUNK_BYTES) {
        const bytes = prepared.template.subarray(offset, offset + CHUNK_BYTES),
          digest = sha(bytes);
        await deps.immutable(join(deps.directory, "chunks", `${digest}.bin`), bytes);
        chunks.push({ digest, byteLength: bytes.length });
      }
      const descriptor = JSON.stringify({
        version: 1,
        templateDigest: prepared.receipt.templateDigest,
        byteLength: prepared.template.length,
        slots: prepared.receipt.slots,
        chunks,
      });
      if (Buffer.byteLength(descriptor) > NATIVE_BUFFER_TEMPLATE_DESCRIPTOR_BYTES) throw corrupt();
      await deps.immutable(descriptorPath(prepared.receipt.templateDigest), descriptor);
    },
    async read(
      input: unknown,
      maximum: number,
      expected?: { byteLength: number; digest: string },
    ): Promise<{ raw: Buffer; bytes: number }> {
      if (
        !record(input) ||
        Object.keys(input).length !== 7 ||
        input.version !== 1 ||
        typeof input.templateDigest !== "string" ||
        !hex.test(input.templateDigest) ||
        !integer(input.templateBytes) ||
        input.templateBytes > maximum ||
        !integer(input.slots) ||
        input.slots > MAX_SLOTS ||
        input.slots > input.templateBytes ||
        typeof input.replacements !== "string" ||
        input.replacements.length > Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4 ||
        !integer(input.replacementBytes) ||
        input.replacementBytes > MAX_TOKEN_BYTES ||
        typeof input.replacementDigest !== "string" ||
        !hex.test(input.replacementDigest)
      )
        throw corrupt();
      const compressed = Buffer.from(input.replacements, "base64");
      if (
        compressed.toString("base64") !== input.replacements ||
        compressed.length > MAX_COMPRESSED_BYTES
      )
        throw corrupt();
      let tokens: unknown;
      try {
        const bytes = inflateRawSync(compressed, { maxOutputLength: MAX_TOKEN_BYTES });
        if (bytes.length !== input.replacementBytes || sha(bytes) !== input.replacementDigest)
          throw corrupt();
        tokens = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw corrupt();
      }
      if (
        !Array.isArray(tokens) ||
        tokens.length !== input.slots ||
        tokens.some(
          (token) =>
            typeof token !== "string" || !(number.test(token) || variableString.test(token)),
        )
      )
        throw corrupt();
      const descriptorRaw = await deps.read(
        descriptorPath(input.templateDigest),
        NATIVE_BUFFER_TEMPLATE_DESCRIPTOR_BYTES,
      );
      if (!descriptorRaw) throw corrupt();
      const descriptor: unknown = JSON.parse(descriptorRaw.toString("utf8"));
      if (
        !record(descriptor) ||
        descriptor.version !== 1 ||
        descriptor.templateDigest !== input.templateDigest ||
        descriptor.byteLength !== input.templateBytes ||
        descriptor.slots !== input.slots ||
        !Array.isArray(descriptor.chunks) ||
        descriptor.chunks.length > Math.ceil(maximum / CHUNK_BYTES)
      )
        throw corrupt();
      const chunks: Buffer[] = [];
      let total = 0;
      for (const chunk of descriptor.chunks) {
        if (
          !record(chunk) ||
          typeof chunk.digest !== "string" ||
          !hex.test(chunk.digest) ||
          !integer(chunk.byteLength) ||
          chunk.byteLength === 0 ||
          chunk.byteLength > CHUNK_BYTES ||
          total + chunk.byteLength > input.templateBytes
        )
          throw corrupt();
        const bytes = await deps.read(
          join(deps.directory, "chunks", `${chunk.digest}.bin`),
          CHUNK_BYTES,
        );
        if (!bytes || bytes.length !== chunk.byteLength || sha(bytes) !== chunk.digest)
          throw corrupt();
        chunks.push(bytes);
        total += bytes.length;
      }
      const template = Buffer.concat(chunks, total);
      if (total !== input.templateBytes || sha(template) !== input.templateDigest) throw corrupt();
      const pieces: Buffer[] = [];
      let start = 0,
        slot = 0,
        outputBytes = total - input.slots;
      for (let offset = 0; offset < template.length; offset++) {
        if (template[offset] !== 0) continue;
        if (slot >= tokens.length) throw corrupt();
        const token = Buffer.from(tokens[slot++] as string);
        outputBytes += token.length;
        if (outputBytes > maximum) throw corrupt();
        pieces.push(template.subarray(start, offset), token);
        start = offset + 1;
      }
      if (slot !== tokens.length || outputBytes < 0) throw corrupt();
      pieces.push(template.subarray(start));
      const raw = Buffer.concat(pieces, outputBytes);
      if (expected && (raw.length !== expected.byteLength || sha(raw) !== expected.digest))
        throw corrupt();
      return { raw, bytes: descriptorRaw.length + total };
    },
  };
}
