import { type RemoteProvider } from "../../src/features/connections/model/protocol";
import { type LocalSessionLocator } from "../../src/features/sessions/model/localSessionReference";
import { skillInvocationTokens } from "../../src/features/skills/model/skillTokens";
import { LeaseHeldError } from "../../src/features/sync/model/runLease";
import { AttachmentOwnership } from "../attachments/attachment-ownership";
import { DesktopDelete } from "../desktop/desktopDelete";
import { type DesktopSessionMeta } from "../desktop/desktopSessions";
import { SessionQueues } from "../sessions/session-queue";
import { AdoptedChanges } from "../workspaces/adoptedChanges";
import type { ServerBindings } from "./bindings";
export async function createSessionsRuntime(
  dependencies: Pick<
    ServerBindings,
    "engine" | "desktop" | "assertHostMayRun" | "providers" | "refresh"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createSessionsRuntime>>) => void,
) {
  publish({
    get sessionRead() {
      return sessionRead;
    },
    get inHost() {
      return inHost;
    },
    get localSessionReference() {
      return localSessionReference;
    },
    get desktopDelete() {
      return desktopDelete;
    },
    get sessionQueues() {
      return sessionQueues;
    },
    get writerTransfers() {
      return writerTransfers;
    },
    get withRetiredDesktopWriters() {
      return withRetiredDesktopWriters;
    },
    get adoptedChanges() {
      return adoptedChanges;
    },
    get attachmentOwnership() {
      return attachmentOwnership;
    },
    get desktopSnapshot() {
      return desktopSnapshot;
    },
    get adopt() {
      return adopt;
    },
    get featureSession() {
      return featureSession;
    },
    get desktopMeta() {
      return desktopMeta;
    },
    get featureMeta() {
      return featureMeta;
    },
    get stableMetas() {
      return stableMetas;
    },
    get featureMetaStable() {
      return featureMetaStable;
    },
    get queueSessionStatus() {
      return queueSessionStatus;
    },
    get queueSessionKnown() {
      return queueSessionKnown;
    },
    get explicitSkillNames() {
      return explicitSkillNames;
    },
  });

  const sessionRead = <T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> =>
    signal ? dependencies.engine.store.withReadCancellation(signal, work) : work();
  const inHost = async (id: string, signal?: AbortSignal) => {
    return !!(await sessionRead(signal, () => dependencies.engine.store.sessionAuthority(id)));
  };
  const localSessionReference = async (id: string): Promise<LocalSessionLocator | undefined> =>
    (await inHost(id))
      ? {
          kind: "host",
          environmentId: dependencies.engine.store.environmentId,
          sessionId: id,
        }
      : await dependencies.desktop.localSessionReferenceAsync(id);
  const desktopDelete = new DesktopDelete();
  const sessionQueues = new SessionQueues(dependencies.engine.store.db);
  const writerTransfers = new Set<string>();
  const withRetiredDesktopWriters = async <T>(id: string, run: () => Promise<T>): Promise<T> => {
    if (writerTransfers.has(id)) throw new LeaseHeldError("host");
    writerTransfers.add(id);
    try {
      await dependencies.desktop.live.retireWriters(id);
      await dependencies.assertHostMayRun(id);
      return await run();
    } finally {
      writerTransfers.delete(id);
    }
  };
  await sessionQueues.ready;
  /** Which desktop window runs a turn of which conversation (the host's own are the engine's). */
  const adoptedChanges = new AdoptedChanges(
    async () => await dependencies.engine.store.adopted(),
    () => dependencies.engine.store.changes.version,
  );
  const attachmentOwnership = new AttachmentOwnership(dependencies.engine.store);
  void attachmentOwnership.ready.catch(() => {});
  /** A desktop-only session on this machine, matched to a registered project. */
  const desktopSnapshot = async (id: string, signal?: AbortSignal) => {
    if (!id || (await inHost(id, signal))) return undefined;
    const cwd = await dependencies.desktop.projectCwdAsync(id, signal);
    const project = cwd
      ? (await sessionRead(signal, () => dependencies.engine.store.projects())).find((p) =>
          dependencies.desktop.samePath(p.cwd, cwd),
        )
      : undefined;
    const snapshot =
      project && (await dependencies.desktop.snapshotAsync(id, project.id, project.cwd, signal));
    return snapshot &&
      (snapshot.session.harness === "acp" ||
        dependencies.providers.includes(snapshot.session.harness as RemoteProvider))
      ? snapshot
      : undefined;
  };
  const adopt = async (id: string) => {
    const snapshot = await desktopSnapshot(id);
    if (snapshot) await dependencies.engine.adoptSession(snapshot);
    else await dependencies.refresh(id);
  };
  const featureSession = async (id: string) => {
    const snapshot = await desktopSnapshot(id);
    if (snapshot) return snapshot;
    return await dependencies.engine.store.session(id);
  };
  /**
   * A desktop-only session without its 7-10 MB transcript (`snapshotMetaAsync`): project,
   * folder, harness, model, settings, usage limit and the last user block's text. Use it
   * wherever a call site decides on those; keep `featureSession` where the blocks are the
   * content (a conversation page, a provider prompt built from history, adoption).
   */
  const desktopMeta = async (id: string): Promise<DesktopSessionMeta | undefined> => {
    if (!id || (await inHost(id))) return undefined;
    const cwd = await dependencies.desktop.projectCwdAsync(id);
    const project = cwd
      ? (await dependencies.engine.store.projects()).find((p) =>
          dependencies.desktop.samePath(p.cwd, cwd),
        )
      : undefined;
    const snapshot =
      project && (await dependencies.desktop.snapshotMetaAsync(id, project.id, project.cwd));
    return snapshot &&
      (snapshot.session.harness === "acp" ||
        dependencies.providers.includes(snapshot.session.harness as RemoteProvider))
      ? snapshot
      : undefined;
  };
  /** Same ownership rules as `featureSession`: the desktop-only copy, else the host's own. */
  const featureMeta = async (id: string): Promise<DesktopSessionMeta> => {
    const meta = await desktopMeta(id);
    if (meta) return meta;
    const hosted = await dependencies.engine.store.session(id);
    const lastUser = hosted.session.blocks.findLast((block) => block.role === "user");
    return { ...hosted, lastUserText: lastUser?.text ?? "" };
  };
  /**
   * Reads that need only what a commit left (a queued send's model, the last user block)
   * do not query the desktop database again while the desktop stamp is unchanged.
   * The stamp is read first, so a newer transcript only ever causes one more read.
   * Never use it for an authority recheck.
   */
  const stableMetas = new Map<string, { key: string; value: DesktopSessionMeta }>();
  const featureMetaStable = async (id: string): Promise<DesktopSessionMeta> => {
    if (!id || (await inHost(id))) return await featureMeta(id);
    const stamp = await dependencies.desktop.stampAsync(id);
    const key = stamp ? `${stamp.updatedAt}\0${stamp.running}` : undefined;
    const known = stableMetas.get(id);
    if (key && known?.key === key) return known.value;
    const value = await featureMeta(id);
    stableMetas.delete(id);
    if (key) {
      stableMetas.set(id, { key, value });
      while (stableMetas.size > 2) stableMetas.delete(stableMetas.keys().next().value!);
    }
    return value;
  };
  const queueSessionStatus = async (id: string) => {
    const metadata = await dependencies.desktop.metadataAsync(id);
    if (
      metadata &&
      (metadata.harness === "acp" ||
        dependencies.providers.includes(metadata.harness as RemoteProvider)) &&
      (await dependencies.engine.store.projects()).some((project) =>
        dependencies.desktop.samePath(project.cwd, metadata.cwd),
      )
    )
      return metadata.running ? "running" : "idle";
    return await dependencies.engine.store.sessionStatus(id);
  };
  /** Existence check for queue calls. A conversation the host already stores is one indexed
   * read; only a desktop-only one needs the desktop notes worker, which may be busy for long.
   * `running` asks for the desktop's live status (only finishing without acceptance needs it). */
  const queueSessionKnown = async (id: string, running = false) => {
    if (running) return await queueSessionStatus(id);
    try {
      return await dependencies.engine.store.sessionStatus(id);
    } catch {
      return await queueSessionStatus(id);
    }
  };
  const explicitSkillNames = async (id: string) =>
    skillInvocationTokens((await featureMetaStable(id)).lastUserText).map((token) =>
      token.name.replace(/^skill:/, ""),
    );
  return {
    sessionRead,
    inHost,
    localSessionReference,
    desktopDelete,
    sessionQueues,
    writerTransfers,
    withRetiredDesktopWriters,
    adoptedChanges,
    attachmentOwnership,
    desktopSnapshot,
    adopt,
    featureSession,
    desktopMeta,
    featureMeta,
    stableMetas,
    featureMetaStable,
    queueSessionStatus,
    queueSessionKnown,
    explicitSkillNames,
  };
}
