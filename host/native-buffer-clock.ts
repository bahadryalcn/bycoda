import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { durableWrite } from "./turn-git-history";

// One fixed-width, append-and-sync record per reservation. Reading its first,
// last and pointer records is constant work, including after a lost write ACK.
const RECORD_BYTES = 184;
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const failure = () =>
  new Error(
    "Native buffer reservation clock is unavailable, stale or corrupt; retained sources remain held",
  );
type RecordValue = { value: number; clockId: string; previous: string; digest: string };
type Head = {
  version: 1;
  reportId: string;
  clockId: string;
  base: number;
  highWater: number;
  digest: string;
};
type Marker = { version: 1; reportId: string; clockId: string; base: number };
type Options = {
  observedVersion: number;
  observedClockId?: string;
  /** First legacy adoption only; never used by an initialized ordinary clock. */
  bootstrap(): Promise<number>;
  authorize(): Promise<void>;
};
function encode(value: number, clockId: string, previous: string): Buffer {
  if (!integer(value) || !uuid.test(clockId) || !hex.test(previous)) throw failure();
  const prefix = `${value.toString().padStart(16, "0")}|${clockId}|${previous}`;
  return Buffer.from(`${prefix}|${sha(prefix)}\n`, "ascii");
}
function decode(bytes: Buffer): RecordValue {
  const match = /^(\d{16})\|([a-f0-9-]{36})\|([a-f0-9]{64})\|([a-f0-9]{64})\n$/.exec(
    bytes.toString("utf8"),
  );
  if (
    bytes.length !== RECORD_BYTES ||
    !match ||
    !uuid.test(match[2]) ||
    !integer(Number(match[1])) ||
    sha(`${match[1]}|${match[2]}|${match[3]}`) !== match[4]
  )
    throw failure();
  return { value: Number(match[1]), clockId: match[2], previous: match[3], digest: match[4] };
}
async function json(path: string): Promise<Record<string, unknown> | null> {
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    if ((await file.stat()).size > 4096) throw failure();
    const bytes = Buffer.alloc(4097),
      { bytesRead } = await file.read(bytes);
    if (bytesRead > 4096) throw failure();
    const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure();
    return value as Record<string, unknown>;
  } catch {
    throw failure();
  } finally {
    await file.close();
  }
}

/** The owning Host serial gate must wrap reserve. This is a monotonic local
 * reservation owner, not an actor grant or coherent backup/restore proof. */
export function createNativeBufferClock(deps: { root: string; write?: typeof durableWrite }) {
  const write = deps.write ?? durableWrite;
  return {
    async reserve(reportId: string, options: Options): Promise<{ value: number; clockId: string }> {
      if (!hex.test(reportId) || !integer(options.observedVersion)) throw failure();
      const directory = join(deps.root, "native-activity", "buffer-history", "clocks");
      const journalPath = join(directory, `${reportId}.journal`),
        markerPath = join(directory, `${reportId}.initialized.json`),
        headPath = join(directory, `${reportId}.head.json`);
      let marker = await json(markerPath),
        head = await json(headPath);
      let journal;
      try {
        journal = await open(journalPath, "r");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!journal) {
        // An initialized/missing clock is not a legacy database. Never rebuild
        // it from current data: previously reserved gaps may exist only here.
        if (marker || head || options.observedClockId) throw failure();
        const base = await options.bootstrap();
        if (!integer(base) || base < options.observedVersion) throw failure();
        await options.authorize();
        await write(journalPath, encode(base, randomUUID(), "0".repeat(64)));
        journal = await open(journalPath, "r");
      }
      let first: RecordValue, last: RecordValue;
      try {
        const size = (await journal.stat()).size;
        if (!Number.isSafeInteger(size) || size < RECORD_BYTES || size % RECORD_BYTES !== 0)
          throw failure();
        const at = async (offset: number) => {
          const bytes = Buffer.alloc(RECORD_BYTES),
            { bytesRead } = await journal!.read(bytes, 0, RECORD_BYTES, offset);
          if (bytesRead !== RECORD_BYTES) throw failure();
          return decode(bytes);
        };
        first = await at(0);
        last = size === RECORD_BYTES ? first : await at(size - RECORD_BYTES);
        if (
          first.previous !== "0".repeat(64) ||
          last.clockId !== first.clockId ||
          last.value !== first.value + size / RECORD_BYTES - 1 ||
          last.value < options.observedVersion ||
          (options.observedClockId !== undefined && options.observedClockId !== first.clockId)
        )
          throw failure();
        if (size > RECORD_BYTES) {
          const prior = await at(size - 2 * RECORD_BYTES);
          if (
            prior.value + 1 !== last.value ||
            prior.clockId !== last.clockId ||
            prior.digest !== last.previous
          )
            throw failure();
        }
        if (marker) {
          if (
            marker.version !== 1 ||
            marker.reportId !== reportId ||
            marker.clockId !== first.clockId ||
            marker.base !== first.value
          )
            throw failure();
        } else {
          if (size !== RECORD_BYTES || head || options.observedClockId) throw failure();
          const initial: Marker = {
            version: 1,
            reportId,
            clockId: first.clockId,
            base: first.value,
          };
          await options.authorize();
          await write(markerPath, JSON.stringify(initial));
          marker = initial;
        }
        if (head) {
          if (
            head.version !== 1 ||
            head.reportId !== reportId ||
            head.clockId !== first.clockId ||
            head.base !== first.value ||
            !integer(head.highWater) ||
            head.highWater < first.value ||
            head.highWater > last.value ||
            typeof head.digest !== "string" ||
            !hex.test(head.digest)
          )
            throw failure();
          const pointed = await at((head.highWater - first.value) * RECORD_BYTES);
          if (
            pointed.value !== head.highWater ||
            pointed.clockId !== first.clockId ||
            pointed.digest !== head.digest
          )
            throw failure();
        }
        if (!head || head.highWater !== last.value) {
          // Tail is durable authority. A failed pointer ACK leaves a gap; repair
          // the cache to that exact tail before reserving the next version.
          const repaired: Head = {
            version: 1,
            reportId,
            clockId: first.clockId,
            base: first.value,
            highWater: last.value,
            digest: last.digest,
          };
          await options.authorize();
          await write(headPath, JSON.stringify(repaired));
          head = repaired;
        }
      } finally {
        await journal.close();
      }
      if (!integer(last.value + 1)) throw new Error("Native buffer report version exhausted");
      const value = last.value + 1,
        encoded = encode(value, first.clockId, last.digest);
      await options.authorize();
      const append = await open(journalPath, "a", 0o600);
      try {
        await append.writeFile(encoded);
        await append.sync();
      } finally {
        await append.close();
      }
      // No mutation is allowed to use this reservation before the durable head
      // settles. Failure leaves the appended value consumed, never reusable.
      const advanced: Head = {
        version: 1,
        reportId,
        clockId: first.clockId,
        base: first.value,
        highWater: value,
        digest: decode(encoded).digest,
      };
      await options.authorize();
      await write(headPath, JSON.stringify(advanced));
      await options.authorize();
      return { value, clockId: first.clockId };
    },
  };
}
