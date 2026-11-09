import {
  assertDomainAuthority as assertSessionAuthority,
  type HostDomainContext as SessionDomainContext,
} from "../context";
import { SessionReadError } from "./read-errors";
export {
  assertDomainAuthority as assertSessionAuthority,
  type HostDomainContext as SessionDomainContext,
} from "../context";

/** Structural projections preserve feature-owned payloads without importing UI models. */
export interface ReadBlock {
  id: string;
  role: string;
  text: string;
  draft?: boolean;
  durationMs?: number;
  approval?: { decided?: unknown };
}
export interface ReadView {
  revision: number;
  sourceEpoch?: string;
  status: "idle" | "running" | "interrupted";
  executionOwner?: "host" | "desktop";
  session: { blocks: ReadBlock[] };
}
export interface ReadDelta {
  revision: number;
  sourceEpoch?: string;
  status: "idle" | "running" | "interrupted";
  executionOwner?: "host" | "desktop";
  head?: { count: number; chain: string };
  session: object;
}
export type ReadSync<View, Delta, Block> =
  | { kind: "unchanged"; revision: number; sourceEpoch?: string }
  | { kind: "snapshot"; value: View; sourceEpoch?: string }
  | {
      kind: "delta";
      sourceEpoch?: string;
      partial?: true;
      base: number;
      value: Delta;
      blockIds: string[];
      blocks: Block[];
    };
export interface DesktopReadWatch {
  projectId?: string;
  revision: number;
}
export interface TranscriptReadPage<View> {
  value: View;
  before?: number;
  totalBlocks: number;
  revision: number;
}
export interface SessionReadPorts<
  View extends ReadView,
  Delta extends ReadDelta,
  Summary,
  Response,
> {
  repository: {
    projectList(
      projectId: string,
      parentSessionId?: string,
    ): Promise<{ list: Summary[]; etag: string }>;
    session(sessionId: string, signal?: AbortSignal): Promise<View>;
    sync(
      sessionId: string,
      revision?: number,
      signal?: AbortSignal,
    ): Promise<ReadSync<View, Delta, View["session"]["blocks"][number]>>;
    readView(sessionId: string): Promise<View>;
    catchUp(sessionId: string, signal?: AbortSignal): Promise<void>;
  };
  nativeProjection: {
    watch(
      sessionId: string,
      fresh?: boolean,
      signal?: AbortSignal,
    ): Promise<DesktopReadWatch | undefined>;
    view(sessionId: string, projectId?: string, signal?: AbortSignal): Promise<View | undefined>;
    sync(view: View, revision?: number): ReadSync<View, Delta, View["session"]["blocks"][number]>;
    recheckMs(sessionId: string): Promise<number>;
  };
  transcript: {
    page(
      load: () => View | Promise<View>,
      sessionId: string,
      before?: number,
      revision?: number,
      preview?: boolean,
      digests?: boolean,
    ): Promise<TranscriptReadPage<View>>;
    preview(view: View, digests: boolean): View;
    summaryPage(view: View): TranscriptReadPage<View>;
    partial(
      sync: ReadSync<View, Delta, View["session"]["blocks"][number]>,
      current: View,
      loadedIds: string[],
      digests: boolean,
    ): ReadSync<View, Delta, View["session"]["blocks"][number]> | undefined;
    withHead(view: View): Partial<Delta>;
    previewRewindHistory(session: Delta["session"]): Partial<Delta["session"]>;
  };
  transfers: {
    respond(
      sessionId: string,
      sync: ReadSync<View, Delta, View["session"]["blocks"][number]>,
    ): Response;
    chunk(sessionId: string, transfer: string, offset: number): { data: string };
  };
  revisionWaits: {
    wait(
      readRevision: () => Promise<number>,
      revision: number,
      waitMs: number,
      cancelled: () => Promise<boolean>,
      recheckMs: () => Promise<number>,
    ): Promise<unknown>;
  };
  /** Identifies the current read owner and its overlay lifecycle. */
  sourceEpoch?(sessionId: string): Promise<string>;
  /** Exact persistent origin, checked before loading and before disclosing a link target. */
  assertReference?(sessionId: string, reference: unknown): Promise<void>;
}

// These parameters intentionally retain the legacy HTTP coercion contract. WS
// admission validates the neutral schemas before invoking the same service.
type LegacyParams = Readonly<Record<string, unknown>>;
export function createSessionReadService<
  View extends ReadView,
  Delta extends ReadDelta,
  Summary,
  Response,
>(ports: SessionReadPorts<View, Delta, Summary, Response>) {
  type Sync = ReadSync<View, Delta, View["session"]["blocks"][number]>;
  const read = async <T>(
    context: SessionDomainContext,
    operation: () => Promise<T>,
  ): Promise<T> => {
    await assertSessionAuthority(context);
    const value = await operation();
    await assertSessionAuthority(context);
    return value;
  };
  const load = async (id: string, watch?: DesktopReadWatch): Promise<View> =>
    (watch && (await ports.nativeProjection.view(id, watch.projectId))) ??
    (await ports.repository.session(id));
  const readSync = (params: LegacyParams, context: SessionDomainContext, complete = false) => {
    return read(context, async () => {
      const id = String(params.sessionId ?? "");
      const epoch = await ports.sourceEpoch?.(id);
      const revision =
        (!epoch || params.sourceEpoch === epoch) && Number.isSafeInteger(params.revision)
          ? Number(params.revision)
          : undefined;
      if (revision !== undefined && Number.isFinite(params.waitMs) && Number(params.waitMs) > 0) {
        await ports.revisionWaits.wait(
          async () =>
            (
              await (context.signal
                ? ports.nativeProjection.watch(id, true, context.signal)
                : ports.nativeProjection.watch(id, true))
            )?.revision ?? (await ports.repository.session(id)).revision,
          revision,
          Number(params.waitMs),
          async () =>
            context.signal?.aborted === true ||
            context.closing?.() === true ||
            !(await context.authorized()),
          () => ports.nativeProjection.recheckMs(id),
        );
        await assertSessionAuthority(context);
      }
      const watch = await (context.signal
        ? ports.nativeProjection.watch(id, false, context.signal)
        : ports.nativeProjection.watch(id));
      let current: View;
      let sync: Sync;
      if (watch && revision === watch.revision) {
        if (epoch && epoch !== (await ports.sourceEpoch?.(id)))
          throw new SessionReadError("source-changed");
        return { kind: "unchanged" as const, revision, ...(epoch ? { sourceEpoch: epoch } : {}) };
      }
      const view =
        watch &&
        (await (context.signal
          ? ports.nativeProjection.view(id, watch.projectId, context.signal)
          : ports.nativeProjection.view(id, watch.projectId)));
      if (view) {
        current = view;
        sync = ports.nativeProjection.sync(view, revision);
      } else {
        context.signal?.throwIfAborted();
        await (context.signal
          ? ports.repository.catchUp(id, context.signal)
          : ports.repository.catchUp(id));
        context.signal?.throwIfAborted();
        current = await (context.signal
          ? ports.repository.session(id, context.signal)
          : ports.repository.session(id));
        sync = await (context.signal
          ? ports.repository.sync(id, revision, context.signal)
          : ports.repository.sync(id, revision));
      }
      if (params.partial === true && (!epoch || params.sourceEpoch === epoch)) {
        const ids = params.loadedBlockIds ?? [];
        if (
          !Array.isArray(ids) ||
          ids.length > 32768 ||
          ids.some((id) => typeof id !== "string" || !id || id.length > 512)
        )
          throw new Error("Invalid loaded block IDs");
        if (sync.kind !== "unchanged") {
          const partial = ports.transcript.partial(
            sync,
            current,
            ids as string[],
            params.digests === true,
          );
          sync = partial ?? {
            kind: "snapshot",
            value: (
              await ports.transcript.page(
                () => current,
                id,
                undefined,
                undefined,
                true,
                params.digests === true,
              )
            ).value,
          };
        }
      }
      if (sync.kind === "snapshot" && !complete)
        sync = { ...sync, value: ports.transcript.preview(sync.value, params.digests === true) };
      else if (sync.kind === "delta")
        sync = {
          ...sync,
          value: {
            ...sync.value,
            ...(params.digests === true && !sync.value.head
              ? ports.transcript.withHead(current)
              : {}),
            session: {
              ...sync.value.session,
              ...ports.transcript.previewRewindHistory(sync.value.session),
            },
          },
        };
      if (sync.kind === "snapshot")
        sync = {
          ...sync,
          value: {
            ...sync.value,
            executionOwner:
              sync.value.status === "running" ? (watch ? "desktop" : "host") : undefined,
          },
        };
      else if (sync.kind === "delta")
        sync = {
          ...sync,
          value: {
            ...sync.value,
            executionOwner:
              sync.value.status === "running" ? (watch ? "desktop" : "host") : undefined,
          },
        };
      if (epoch && epoch !== (await ports.sourceEpoch?.(id)))
        throw new SessionReadError("source-changed");
      if (!epoch) return sync;
      if (sync.kind === "unchanged") return { ...sync, sourceEpoch: epoch };
      if (sync.kind === "snapshot")
        return { ...sync, value: { ...sync.value, sourceEpoch: epoch } };
      return { ...sync, value: { ...sync.value, sourceEpoch: epoch } };
    });
  };
  return {
    list(params: LegacyParams, context: SessionDomainContext) {
      return read(context, async () => {
        const { list, etag } = await ports.repository.projectList(
          String(params.projectId ?? ""),
          typeof params.parentSessionId === "string" ? params.parentSessionId : undefined,
        );
        return typeof params.known === "string"
          ? params.known === etag
            ? { unchanged: true as const, etag }
            : { etag, sessions: list }
          : list;
      });
    },
    page(params: LegacyParams, context: SessionDomainContext) {
      return read(context, async () => {
        const id = String(params.sessionId ?? "");
        const epoch = await ports.sourceEpoch?.(id);
        const watch = await (context.signal
          ? ports.nativeProjection.watch(id, false, context.signal)
          : ports.nativeProjection.watch(id));
        const { value, ...page } = await ports.transcript.page(
          () => load(id, watch),
          id,
          params.before === undefined ? undefined : Number(params.before),
          params.revision === undefined ? undefined : Number(params.revision),
          params.preview === true,
          params.digests === true,
        );
        if (epoch && epoch !== (await ports.sourceEpoch?.(id)))
          throw new SessionReadError("source-changed");
        return {
          ...page,
          sync: ports.transfers.respond(id, {
            kind: "snapshot",
            value: {
              ...value,
              ...(epoch ? { sourceEpoch: epoch } : {}),
              executionOwner: value.status === "running" ? (watch ? "desktop" : "host") : undefined,
            },
          }),
        };
      });
    },
    async sync(params: LegacyParams, context: SessionDomainContext) {
      const sync = await readSync(params, context);
      return sync.kind === "unchanged"
        ? sync
        : ports.transfers.respond(String(params.sessionId ?? ""), sync);
    },
    stream(params: LegacyParams, context: SessionDomainContext) {
      return readSync(params, context, true);
    },
    get(params: LegacyParams, context: SessionDomainContext) {
      return read(context, async () => {
        const id = String(params.sessionId ?? "");
        const assertReference = async () => {
          if (params.reference === undefined) return;
          if (!ports.assertReference) throw new Error("Reference unavailable");
          await ports.assertReference(id, params.reference);
        };
        await assertReference();
        const value = await ports.repository.readView(id);
        await assertReference();
        if (value.revision === params.revision) return null;
        if (params.preview !== true) return value;
        const blocks = value.session.blocks;
        const summary =
          params.summary === true
            ? {
                ...value,
                session: {
                  ...value.session,
                  blocks: [
                    blocks.findLast((block) => block.role === "assistant" && block.text.trim()),
                    blocks.findLast((block) => block.role === "system" && block.text.trim()),
                    blocks.findLast((block) => block.approval && !block.approval.decided),
                  ].filter((block): block is (typeof blocks)[number] => block !== undefined),
                },
              }
            : value;
        return ports.transcript.summaryPage(summary).value;
      });
    },
    block(params: LegacyParams, context: SessionDomainContext) {
      return read(context, async () => {
        const id = String(params.sessionId ?? ""),
          blockId = String(params.blockId ?? "");
        if (!blockId || blockId.length > 512 || !Number.isSafeInteger(params.revision))
          throw new Error("Invalid transcript block request");
        const value = await load(id, await ports.nativeProjection.watch(id));
        if (value.revision !== params.revision)
          throw new Error("Transcript changed; reload history");
        const block = value.session.blocks.find((entry) => entry.id === blockId);
        if (!block) throw new Error("Transcript block no longer exists");
        return ports.transfers.respond(id, {
          kind: "snapshot",
          value: {
            ...value,
            session: { ...value.session, blocks: [block] },
            history: { revision: value.revision, totalBlocks: value.session.blocks.length },
          },
        });
      });
    },
    /** Finished turns only; the reader adds a running turn from its own start time. */
    workedTime(params: LegacyParams, context: SessionDomainContext) {
      return read(context, async () => {
        const id = String(params.sessionId ?? "");
        const value = await load(id, await ports.nativeProjection.watch(id));
        let workedMs = 0;
        for (const block of value.session.blocks) {
          const ms = block.durationMs;
          if (block.role === "user" && !block.draft && typeof ms === "number" && ms > 0)
            workedMs += Number.isFinite(ms) ? ms : 0;
        }
        return { workedMs: Math.round(workedMs) };
      });
    },
    syncChunk(params: LegacyParams, context: SessionDomainContext) {
      return read(context, async () =>
        ports.transfers.chunk(
          String(params.sessionId ?? ""),
          String(params.transfer ?? ""),
          Number(params.offset),
        ),
      );
    },
  };
}
