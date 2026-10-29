import { join } from "node:path";
import type { createNativeBufferRetention } from "./native-buffer-retention";
import type {
  NativeBufferClockState,
  NativeBufferPersistence,
} from "./ports/native-buffer-persistence";

type Reference = {
  reportId: string;
  reportVersion: number;
  snapshotDigest: string;
  ownerId: string;
  ownerVersion: number;
};
type Source = { reportId: string; raw: Buffer };
type State = { version: number; clockId?: string; hold: boolean };
type ClockOptions = {
  observedVersion: number;
  observedClockId?: string;
  bootstrap(): Promise<number>;
  authorize(): Promise<void>;
};
export type NativeBufferRetentionImporter<T extends Source> = {
  initialize(): Promise<void>;
  importReport(id: string, previous: T | null, authorize: () => Promise<void>): Promise<void>;
  initializeClock(
    state: NativeBufferClockState,
    authorize: () => Promise<void>,
  ): Promise<NativeBufferClockState>;
};
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Explicit process-startup data migration. It preserves exact legacy bytes and
 * reserved gaps; neither imported metadata nor a floor creates a Native actor. */
export function createNativeBufferRetentionImporter<T extends Source>(deps: {
  persistence: NativeBufferPersistence;
  retention: ReturnType<typeof createNativeBufferRetention>;
  currentDirectory: string;
  historyDirectory: string;
  maximumReportBytes: number;
  maximumManifestBytes: number;
  maximumCatalogBytes: number;
  serial<R>(action: () => Promise<R>): Promise<R>;
  names(path: string): Promise<string[]>;
  legacyNames(path: string): Promise<string[]>;
  read(path: string, limit: number): Promise<Buffer | null>;
  current(id: string): Promise<T | null>;
  state(source: T): State;
  snapshotPath(id: string): string;
  manifestPath(ref: Reference): string;
  archive(source: T): Promise<void>;
  readArchive(ref: Reference, raw: Buffer): Promise<T | null>;
  readCatalog(receipt: unknown, maximum: number): Promise<unknown>;
  bootstrap(id: string, previous: T | null): Promise<number>;
  adopt(id: string, options: ClockOptions): Promise<NativeBufferClockState>;
  certificate(source: T, clock: NativeBufferClockState): void;
}): NativeBufferRetentionImporter<T> {
  const evidence = new Map<
    string,
    { clockId?: string; mismatch: boolean; clocked: number; legacy: number }
  >();
  const currentSources = new Map<string, T>();
  let initialized: Promise<void> | undefined;
  function observe(id: string, version: number, clockId?: unknown) {
    const value = evidence.get(id) ?? { mismatch: false, clocked: 0, legacy: 0 };
    if (clockId === undefined) value.legacy = Math.max(value.legacy, version);
    else {
      if (typeof clockId !== "string" || !uuid.test(clockId))
        throw new Error("Native buffer legacy clock identity is corrupt");
      if (value.clockId && value.clockId !== clockId) value.mismatch = true;
      value.clockId = clockId;
      value.clocked = Math.max(value.clocked, version);
    }
    evidence.set(id, value);
  }
  async function importReport(id: string, previous: T | null, authorize: () => Promise<void>) {
    if (await deps.persistence.readClock(id)) return;
    try {
      let projection = !!previous && !deps.state(previous).hold;
      let hold = !!previous && deps.state(previous).hold;
      for (const name of await deps.names(join(deps.historyDirectory, "reports", id))) {
        const match = /^(\d{16})-([a-f0-9]{64})\.json$/.exec(name);
        if (!match) continue;
        const version = Number(match[1]);
        if (!integer(version)) throw new Error("Native buffer legacy history version is corrupt");
        const source = {
          reportId: id,
          reportVersion: version,
          snapshotDigest: match[2],
          ownerId: "legacy-import",
          ownerVersion: 0,
        };
        const path = deps.manifestPath(source),
          raw = await deps.read(path, deps.maximumManifestBytes);
        if (!raw) throw new Error("Native buffer legacy history changed during retention");
        const manifest: unknown = JSON.parse(raw.toString("utf8"));
        if (
          !record(manifest) ||
          ![1, 2].includes(manifest.version as number) ||
          manifest.reportId !== id ||
          manifest.reportVersion !== version ||
          manifest.snapshotDigest !== match[2] ||
          !integer(manifest.byteLength) ||
          manifest.byteLength > deps.maximumReportBytes
        )
          throw new Error("Native buffer legacy history metadata is corrupt and remains held");
        observe(id, version, manifest.clockId);
        await deps.retention.write(path, raw, true);
        if (manifest.version === 2 && manifest.catalogBody !== undefined) {
          try {
            await deps.retention.captureReads(() =>
              deps.readCatalog(manifest.catalogBody, deps.maximumCatalogBytes),
            );
          } catch (error) {
            if (!(error instanceof Error) || !/Native buffer shared template/.test(error.message))
              throw error;
          }
        }
        try {
          const captured = await deps.retention.captureReads(() => deps.readArchive(source, raw));
          if (captured) {
            const state = deps.state(captured);
            if (state.hold) hold = true;
            else projection = true;
            observe(id, version, state.clockId);
          }
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/Native buffer (immutable|shared template)/.test(error.message)
          )
            throw error;
        }
        await deps.retention.flush(authorize);
      }
      if (previous) {
        const state = deps.state(previous);
        observe(id, state.version, state.clockId);
        await deps.archive(previous);
        await deps.retention.write(deps.snapshotPath(id), previous.raw, state.hold);
        currentSources.set(id, previous);
      }
      const clockDirectory = join(deps.historyDirectory, "clocks");
      if (
        (hold && !projection) ||
        (!previous &&
          !projection &&
          !(await deps.legacyNames(clockDirectory)).some((name) => name.startsWith(`${id}.`)))
      ) {
        await deps.retention.flush(authorize);
        return;
      }
      await deps.adopt(id, {
        observedVersion: previous ? deps.state(previous).version : 0,
        observedClockId: previous ? deps.state(previous).clockId : undefined,
        bootstrap: () => deps.bootstrap(id, previous),
        authorize,
      });
      await deps.retention.flush(authorize);
    } finally {
      currentSources.delete(id);
      evidence.delete(id);
    }
  }
  return {
    importReport,
    async initializeClock(state, authorize) {
      const value = evidence.get(state.reportId);
      if (
        value &&
        (value.mismatch ||
          (value.clockId && value.clockId !== state.clockId) ||
          value.clocked > state.highWater ||
          value.legacy > state.base)
      )
        throw new Error(
          "Native buffer initialized history disagrees with its retained clock and remains held",
        );
      const previous = currentSources.get(state.reportId);
      if (previous) deps.certificate(previous, state);
      await deps.retention.flush(authorize, [state]);
      const stored = await deps.persistence.readClock(state.reportId);
      if (!stored) throw new Error("Native buffer retained clock initialization is unconfirmed");
      return stored;
    },
    initialize() {
      initialized ??= deps.serial(() =>
        deps.retention.mutate(
          async () => {},
          async () => {
            const authorize = async () => {};
            await deps.persistence.complete({ writes: [], certificates: [], authorize });
            const active: string[] = [];
            for (const name of await deps.names(deps.currentDirectory)) {
              if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
              const id = name.slice(0, -5);
              if (await deps.persistence.readClock(id)) continue;
              const captured = await deps.current(id);
              if (!captured) continue;
              const state = deps.state(captured);
              await deps.retention.write(deps.snapshotPath(id), captured.raw, state.hold);
              await deps.retention.flush(authorize);
              if (!state.hold) active.push(id);
            }
            const reports = new Set([
              ...active,
              ...(await deps.names(join(deps.historyDirectory, "reports"))).filter((id) =>
                hex.test(id),
              ),
            ]);
            for (const name of await deps.legacyNames(join(deps.historyDirectory, "clocks"))) {
              const match = /^([a-f0-9]{64})\./.exec(name);
              if (match) reports.add(match[1]);
            }
            for (const id of reports) {
              if (!(await deps.persistence.readClock(id)))
                await importReport(id, await deps.current(id), authorize);
            }
          },
        ),
      );
      void initialized.catch(() => {});
      return initialized;
    },
  };
}
