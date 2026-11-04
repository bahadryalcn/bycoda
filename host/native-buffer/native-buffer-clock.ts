import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { durableWrite } from "../turn-git-history";
import type {
  NativeBufferClockBacking,
  NativeBufferClockState,
} from "../ports/native-buffer-persistence";

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
type Head = NativeBufferClockState;
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

function checkedState(state: NativeBufferClockState, reportId: string, options: Options): Head {
  if (
    !state ||
    state.version !== 1 ||
    state.reportId !== reportId ||
    !uuid.test(state.clockId) ||
    !integer(state.base) ||
    !integer(state.highWater) ||
    state.highWater < state.base ||
    !hex.test(state.digest) ||
    state.highWater < options.observedVersion ||
    (options.observedClockId !== undefined && options.observedClockId !== state.clockId)
  )
    throw failure();
  return state;
}

/** First SQL adoption validates the complete old chain once. The filesystem is
 * never read again after the backing has established this report's clock. */
async function importLegacyState(root: string, reportId: string, options: Options): Promise<Head> {
  const directory = join(root, "native-activity", "buffer-history", "clocks");
  const journalPath = join(directory, `${reportId}.journal`),
    marker = await json(join(directory, `${reportId}.initialized.json`)),
    head = await json(join(directory, `${reportId}.head.json`));
  let journal;
  try {
    journal = await open(journalPath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!journal) {
    if (marker || head || options.observedClockId) throw failure();
    const base = await options.bootstrap();
    if (!integer(base) || base < options.observedVersion) throw failure();
    const clockId = randomUUID();
    return {
      version: 1,
      reportId,
      clockId,
      base,
      highWater: base,
      digest: decode(encode(base, clockId, "0".repeat(64))).digest,
    };
  }
  try {
    const initialStat = await journal.stat(),
      size = initialStat.size;
    if (!Number.isSafeInteger(size) || size < RECORD_BYTES || size % RECORD_BYTES !== 0)
      throw failure();
    const bytes = Buffer.alloc(RECORD_BYTES);
    let first: RecordValue | undefined,
      last: RecordValue | undefined,
      pointed: RecordValue | undefined;
    for (let offset = 0; offset < size; offset += RECORD_BYTES) {
      const { bytesRead } = await journal.read(bytes, 0, RECORD_BYTES, offset);
      if (bytesRead !== RECORD_BYTES) throw failure();
      const record = decode(bytes);
      if (!first) {
        first = record;
        if (first.previous !== "0".repeat(64)) throw failure();
      } else if (
        !last ||
        record.clockId !== first.clockId ||
        record.value !== last.value + 1 ||
        record.previous !== last.digest
      )
        throw failure();
      if (head?.highWater === record.value) pointed = record;
      last = record;
    }
    const finalStat = await journal.stat();
    if (
      !first ||
      !last ||
      finalStat.size !== size ||
      finalStat.mtimeMs !== initialStat.mtimeMs ||
      finalStat.ctimeMs !== initialStat.ctimeMs
    )
      throw failure();
    if (marker) {
      if (
        marker.version !== 1 ||
        marker.reportId !== reportId ||
        marker.clockId !== first.clockId ||
        marker.base !== first.value
      )
        throw failure();
    } else if (size !== RECORD_BYTES || head || options.observedClockId) {
      throw failure();
    }
    if (
      head &&
      (head.version !== 1 ||
        head.reportId !== reportId ||
        head.clockId !== first.clockId ||
        head.base !== first.value ||
        !integer(head.highWater) ||
        head.highWater < first.value ||
        head.highWater > last.value ||
        typeof head.digest !== "string" ||
        !hex.test(head.digest) ||
        !pointed ||
        pointed.clockId !== first.clockId ||
        pointed.digest !== head.digest)
    )
      throw failure();
    return checkedState(
      {
        version: 1,
        reportId,
        clockId: first.clockId,
        base: first.value,
        highWater: last.value,
        digest: last.digest,
      },
      reportId,
      options,
    );
  } finally {
    await journal.close();
  }
}

async function adoptBacked(
  root: string,
  backing: NativeBufferClockBacking,
  reportId: string,
  options: Options,
): Promise<Head> {
  await options.authorize();
  let state = await backing.readClock(reportId);
  if (!state) {
    const initial = await importLegacyState(root, reportId, options);
    await options.authorize();
    state = await backing.initializeClock(initial, options.authorize);
    await options.authorize();
  }
  const current = checkedState(state, reportId, options);
  await options.authorize();
  return current;
}

async function reserveBacked(
  root: string,
  backing: NativeBufferClockBacking,
  reportId: string,
  options: Options,
): Promise<{ value: number; clockId: string }> {
  const current = await adoptBacked(root, backing, reportId, options);
  if (!integer(current.highWater + 1)) throw new Error("Native buffer report version exhausted");
  const value = current.highWater + 1;
  const next: Head = {
    ...current,
    highWater: value,
    digest: decode(encode(value, current.clockId, current.digest)).digest,
  };
  await options.authorize();
  const committed = checkedState(
    await backing.advanceClock(current, next, options.authorize),
    reportId,
    options,
  );
  await options.authorize();
  if (
    committed.clockId !== next.clockId ||
    committed.base !== next.base ||
    committed.highWater !== next.highWater ||
    committed.digest !== next.digest
  )
    throw failure();
  return { value, clockId: committed.clockId };
}

/** The owning Host serial gate must wrap reserve. This is a monotonic local
 * reservation owner, not an actor grant or coherent backup/restore proof. */
export function createNativeBufferClock(deps: {
  root: string;
  write?: typeof durableWrite;
  backing?: NativeBufferClockBacking;
}) {
  const write = deps.write ?? durableWrite;
  return {
    /** Retain an existing clock without manufacturing a new source/report. */
    async adopt(reportId: string, options: Options): Promise<NativeBufferClockState> {
      if (!hex.test(reportId) || !integer(options.observedVersion)) throw failure();
      if (!deps.backing) throw new Error("Native buffer clock adoption requires SQL backing");
      return adoptBacked(deps.root, deps.backing, reportId, options);
    },
    async reserve(reportId: string, options: Options): Promise<{ value: number; clockId: string }> {
      if (!hex.test(reportId) || !integer(options.observedVersion)) throw failure();
      if (deps.backing) return reserveBacked(deps.root, deps.backing, reportId, options);
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
