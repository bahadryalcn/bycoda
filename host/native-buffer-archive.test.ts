import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { expect, it } from "vitest";
import { createNativeBufferTemplates, prepareNativeBufferTemplate } from "./native-buffer-archive";

const sha = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
function fixture() {
  const files = new Map<string, Buffer>();
  return {
    files,
    codec: createNativeBufferTemplates({
      directory: "history",
      read: async (path, maximum) => {
        const bytes = files.get(path);
        if (bytes && bytes.length > maximum) throw new Error("read bound");
        return bytes ?? null;
      },
      immutable: async (path, value) => {
        const bytes = Buffer.from(value);
        if (files.has(path) && !files.get(path)!.equals(bytes))
          throw new Error("immutable identity");
        files.set(path, bytes);
      },
    }),
  };
}

it("shares exact static UTF-8 bytes across changing tokens without parsing/regenerating raw JSON", async () => {
  const f = fixture();
  const original = Buffer.from(
    `\uFEFF { "path":"C:\\\\123\\\\${randomUUID()}\\\\file\\"123.txt", "escaped":"\\u0061\\n", "text":"ş😀", "version" : 1e+02, "reportNonce":"${randomUUID()}" } \r\n`,
  );
  const later = Buffer.from(
    original
      .toString()
      .replace("1e+02", "-123.45e-6")
      .replace(/"reportNonce":"[^"]+"/, `"reportNonce":"${randomUUID()}"`),
  );
  JSON.parse(new TextDecoder().decode(original));
  JSON.parse(new TextDecoder().decode(later));
  const first = prepareNativeBufferTemplate(original, 1024)!,
    second = prepareNativeBufferTemplate(later, 1024)!;
  expect(second.receipt.templateDigest).toBe(first.receipt.templateDigest);
  await f.codec.persist(first);
  const count = f.files.size;
  await f.codec.persist(second);
  expect(f.files.size).toBe(count);
  for (const [prepared, raw] of [
    [first, original],
    [second, later],
  ] as const) {
    expect(
      (await f.codec.read(prepared.receipt, 1024, { byteLength: raw.length, digest: sha(raw) }))
        .raw,
    ).toEqual(raw);
  }
});

it("rejects altered static objects, token receipts, slot counts and decompression expansion", async () => {
  for (const mode of [
    "descriptor",
    "chunk",
    "tokens",
    "slots",
    "length",
    "digest",
    "bomb",
  ] as const) {
    const f = fixture(),
      raw = Buffer.from('{"version":12,"body":"unchanged"}');
    const prepared = prepareNativeBufferTemplate(raw, 1024)!;
    await f.codec.persist(prepared);
    const receipt = structuredClone(prepared.receipt);
    if (mode === "descriptor")
      f.files.set(
        join("history", "templates", `${receipt.templateDigest}.json`),
        Buffer.from("{}"),
      );
    if (mode === "chunk")
      f.files.set(
        [...f.files.keys()].find((key) => key.endsWith(".bin"))!,
        Buffer.from("bad"),
      );
    if (mode === "tokens")
      receipt.replacements = deflateRawSync(Buffer.from('["13"]')).toString("base64");
    if (mode === "slots") receipt.slots++;
    if (mode === "length") receipt.templateBytes++;
    if (mode === "digest") receipt.templateDigest = "0".repeat(64);
    if (mode === "bomb")
      receipt.replacements = deflateRawSync(Buffer.alloc(9 * 1024 * 1024)).toString("base64");
    await expect(
      f.codec.read(receipt, 1024, { byteLength: raw.length, digest: sha(raw) }),
    ).rejects.toThrow(/template|corrupt/);
  }
});

it("shares stable lineage entropy while separating Host source digests from Native provenance", () => {
  const lineage = randomUUID(),
    nativeDigest = "a".repeat(64);
  const row = (hostDigest: string) =>
    Buffer.from(
      JSON.stringify({
        source: { snapshotDigest: hostDigest },
        provenance: {
          storeInstance: lineage,
          snapshotDigest: nativeDigest,
          reportNonce: randomUUID(),
        },
      }),
    );
  const first = prepareNativeBufferTemplate(row("b".repeat(64)), 4096, "catalog")!,
    later = prepareNativeBufferTemplate(row("c".repeat(64)), 4096, "catalog")!;
  expect(later.receipt.templateDigest).toBe(first.receipt.templateDigest);
  expect(first.template.toString()).toContain(lineage);
  expect(first.template.toString()).toContain(nativeDigest);
  expect(first.template.toString()).not.toContain("b".repeat(64));
});

it("falls back rather than dropping raw bytes when token or input budgets cannot represent valid JSON", () => {
  const many = Buffer.from(`[${"1,".repeat(200_001)}1]`);
  expect(() => JSON.parse(many.toString())).not.toThrow();
  expect(prepareNativeBufferTemplate(many, many.length)).toBeNull();
  expect(prepareNativeBufferTemplate(Buffer.from("{}"), 1)).toBeNull();
});
