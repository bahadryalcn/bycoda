import type { GitObjectStore } from "./git-object-store";

/** Manifests read by one shared-key sweep; above this the sweep is skipped for that commit. */
export const NATIVE_BUFFER_SWEEP_MANIFESTS = 2_000;
/** Bytes of manifests and template descriptors read by one sweep. */
export const NATIVE_BUFFER_SWEEP_BYTES = 256 * 1024 * 1024;

const HISTORY = "native-activity/buffer-history";
const SHARED =
  /^native-activity\/buffer-history\/(?:chunks\/([a-f0-9]{64})\.bin|templates\/([a-f0-9]{64})\.json)$/;
const MANIFEST = /^native-activity\/buffer-history\/reports\/.+\.json$/;
const hex = /^[a-f0-9]{64}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const reported = new Set<string>();
class Skip extends Error {}

/** Chunk digests listed as `chunks: [{ digest }]` (v1 manifests and template descriptors). */
function chunkDigests(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.chunks)) throw new Skip("unreadable manifest");
  return value.chunks.map((chunk: unknown) => {
    if (!record(chunk) || typeof chunk.digest !== "string" || !hex.test(chunk.digest))
      throw new Skip("unreadable manifest");
    return chunk.digest;
  });
}
const parse = (bytes: Buffer): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (record(value)) return value;
  } catch {
    // Reported below as a skipped sweep.
  }
  throw new Skip("unreadable manifest");
};

/**
 * Shared `chunks/` and `templates/` keys that no manifest remaining after `drop` references
 * (formats: native-buffer-reports.ts archive() and native-buffer-archive.ts persist()).
 * v1 manifests list chunks; v2 manifests reference `body`/`catalogBody` templates whose
 * descriptors list chunks. Fails safe: any unreadable, missing or over-budget input skips
 * the sweep (returns []), so nothing a reader may still need is deleted.
 */
export async function unreferencedSharedKeys(
  git: GitObjectStore,
  base: string | null,
  added: Map<string, Buffer>,
  drop: Set<string>,
): Promise<string[]> {
  let budget = NATIVE_BUFFER_SWEEP_BYTES;
  const load = async (keys: string[]) => {
    const fromBase = keys.filter((key) => !added.has(key));
    if (fromBase.length && !base) throw new Skip("missing manifest or template");
    const infos = await git.batchCheck(fromBase.map((key) => `${base}:${key}`));
    for (const info of infos) {
      if (!info || info.type !== "blob") throw new Skip("missing manifest or template");
      budget -= info.size;
    }
    if (budget < 0) throw new Skip("byte budget exceeded");
    const bodies = await git.catBatch(
      fromBase.map((key) => `${base}:${key}`),
      infos.reduce((sum, info) => sum + info!.size, 0),
    );
    const values = new Map(fromBase.map((key, index) => [key, bodies[index]]));
    return keys.map((key) => {
      const bytes = added.get(key) ?? values.get(key);
      if (!bytes) throw new Skip("missing manifest or template");
      return parse(bytes);
    });
  };
  try {
    const listed = base ? await git.listFiles(base, [`${HISTORY}/reports/`]) : [];
    const manifests = [...new Set([...listed, ...added.keys()])].filter(
      (key) => MANIFEST.test(key) && !drop.has(key),
    );
    if (manifests.length > NATIVE_BUFFER_SWEEP_MANIFESTS) throw new Skip("manifest cap exceeded");
    const chunks = new Set<string>(),
      templates = new Set<string>();
    for (const manifest of await load(manifests)) {
      if (manifest.version === 1) chunkDigests(manifest).forEach((digest) => chunks.add(digest));
      else if (manifest.version === 2) {
        const receipts =
          manifest.catalogBody === undefined
            ? [manifest.body]
            : [manifest.body, manifest.catalogBody];
        for (const receipt of receipts) {
          if (!record(receipt) || typeof receipt.templateDigest !== "string")
            throw new Skip("unreadable manifest");
          if (!hex.test(receipt.templateDigest)) throw new Skip("unreadable manifest");
          templates.add(receipt.templateDigest);
        }
      } else throw new Skip("unknown manifest version");
    }
    const descriptors = await load(
      [...templates].map((digest) => `${HISTORY}/templates/${digest}.json`),
    );
    for (const descriptor of descriptors)
      chunkDigests(descriptor).forEach((digest) => chunks.add(digest));
    const shared = base
      ? await git.listFiles(base, [`${HISTORY}/chunks/`, `${HISTORY}/templates/`])
      : [];
    return [...new Set([...shared, ...added.keys()])].filter((key) => {
      const match = SHARED.exec(key);
      if (!match || drop.has(key)) return false;
      return match[1] ? !chunks.has(match[1]) : !templates.has(match[2]);
    });
  } catch (error) {
    if (!(error instanceof Skip)) throw error;
    if (!reported.has(error.message)) {
      reported.add(error.message);
      console.warn(`Native buffer git shared-key sweep skipped: ${error.message}.`);
    }
    return [];
  }
}
