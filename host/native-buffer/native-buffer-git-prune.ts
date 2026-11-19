import type { GitObjectStore } from "./git-object-store";

/**
 * Manifests or template descriptors read per `cat-file` batch. History is unbounded, so the
 * sweep walks every remaining manifest in batches of this size instead of capping the count;
 * only the digest sets stay in memory between batches.
 */
export const NATIVE_BUFFER_SWEEP_BATCH = 500;
/** Bytes of manifests and template descriptors read by one batch. */
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
 * descriptors list chunks. Liveness is proven over every remaining manifest (no count cap,
 * read in bounded batches) before anything is reclaimed. Fails safe: any unreadable, missing
 * or over-budget input skips the sweep (returns []), so nothing a reader may still need is
 * deleted.
 */
export async function unreferencedSharedKeys(
  git: GitObjectStore,
  base: string | null,
  added: Map<string, Buffer>,
  drop: Set<string>,
): Promise<string[]> {
  /** Parses `keys` in batches and hands each parsed body to `visit`; keeps no bodies around. */
  const visitAll = async (keys: string[], visit: (value: Record<string, unknown>) => void) => {
    for (let start = 0; start < keys.length; start += NATIVE_BUFFER_SWEEP_BATCH) {
      const batch = keys.slice(start, start + NATIVE_BUFFER_SWEEP_BATCH);
      const fromBase = batch.filter((key) => !added.has(key));
      if (fromBase.length && !base) throw new Skip("missing manifest or template");
      const specs = fromBase.map((key) => `${base}:${key}`);
      const infos = specs.length ? await git.batchCheck(specs) : [];
      let bytes = 0;
      for (const info of infos) {
        if (!info || info.type !== "blob") throw new Skip("missing manifest or template");
        bytes += info.size;
      }
      if (bytes > NATIVE_BUFFER_SWEEP_BYTES) throw new Skip("byte budget exceeded");
      const bodies = specs.length ? await git.catBatch(specs, bytes) : [];
      const values = new Map(fromBase.map((key, index) => [key, bodies[index]]));
      for (const key of batch) {
        const body = added.get(key) ?? values.get(key);
        if (!body) throw new Skip("missing manifest or template");
        visit(parse(body));
      }
    }
  };
  try {
    const listed = base ? await git.listFiles(base, [`${HISTORY}/reports/`]) : [];
    const manifests = [...new Set([...listed, ...added.keys()])].filter(
      (key) => MANIFEST.test(key) && !drop.has(key),
    );
    const chunks = new Set<string>(),
      templates = new Set<string>();
    await visitAll(manifests, (manifest) => {
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
    });
    await visitAll([...templates].map((digest) => `${HISTORY}/templates/${digest}.json`), (value) =>
      chunkDigests(value).forEach((digest) => chunks.add(digest)),
    );
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
