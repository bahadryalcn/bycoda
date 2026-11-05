import { type HostSession, type SessionSync } from "../../src/features/connections/model/protocol";
import { withOverlay } from "../desktop/desktopLive";
import type { ServerBindings } from "./bindings";
import { DESKTOP_RUN_ID, MAX_DESKTOP_VIEWS, MAX_MEMOIZED_VIEWS } from "./support";
export function createSessionViewsRuntime(
  dependencies: Pick<
    ServerBindings,
    "desktop" | "inHost" | "desktopWatch" | "engine" | "sessionRead" | "desktopSnapshot" | "refresh"
  >,
) {
  /** The desktop copy with its live prompts; a running one carries a run id
   * so watchers can stop it and answer its prompts. */
  const desktopView = async (
    id: string,
    projectId?: string,
    signal?: AbortSignal,
  ): Promise<Awaited<HostSession | undefined>> => {
    // Watchers re-request the same unchanged transcript many times (pages,
    // block fetches, polls); parsing it again is only needed once it moves.
    const stamp = await dependencies.desktop.stampAsync(id, 0, signal);
    const key =
      stamp && (projectId || !(await dependencies.inHost(id, signal)))
        ? `${id}\0${projectId ?? ""}\0${stamp.updatedAt}\0${stamp.running}\0${dependencies.desktop.live.overlay(id)?.changedAt ?? 0}`
        : undefined;
    const known = key ? viewMemo.get(key) : undefined;
    if (known) return known;
    const view = await buildDesktopView(id, projectId, signal);
    if (key && view) {
      for (const old of viewMemo.keys()) if (old.startsWith(`${id}\0`)) viewMemo.delete(old);
      viewMemo.set(key, view);
      while (viewMemo.size > MAX_MEMOIZED_VIEWS) viewMemo.delete(viewMemo.keys().next().value!);
    }
    return view;
  };
  /** The same authoritative read owner used for transcript and context previews. */
  const readSessionView = async (id: string) => {
    const watch = await dependencies.desktopWatch(id);
    const value =
      (watch && (await desktopView(id, watch.projectId))) ??
      (await dependencies.engine.store.session(id));
    return {
      ...value,
      executionOwner:
        value.status === "running" ? (watch ? ("desktop" as const) : ("host" as const)) : undefined,
    };
  };
  const viewMemo = new Map<string, HostSession>();
  const buildDesktopView = async (
    id: string,
    projectId?: string,
    signal?: AbortSignal,
  ): Promise<Awaited<HostSession | undefined>> => {
    const project = projectId
      ? await dependencies.sessionRead(signal, () => dependencies.engine.store.project(projectId))
      : undefined;
    const snapshot = project
      ? await dependencies.desktop.snapshotAsync(id, project.id, project.cwd, signal)
      : await dependencies.desktopSnapshot(id, signal);
    if (!snapshot) return undefined;
    const overlay = dependencies.desktop.live.overlay(id);
    return {
      ...snapshot,
      revision: Math.max(snapshot.revision, overlay?.changedAt ?? 0),
      ...(snapshot.status === "running" ? { runId: DESKTOP_RUN_ID } : {}),
      ...(snapshot.blockRevisions
        ? {
            blockRevisions: {
              ...snapshot.blockRevisions,
              ...Object.fromEntries(
                (overlay?.pending ?? []).map((block) => [
                  block.id,
                  overlay?.changedAt ?? snapshot.revision,
                ]),
              ),
            },
          }
        : {}),
      // The desktop's own bookkeeping about its host copy is not part of the view.
      session: (({ adoptedBase: _base, ...session }) => session)(
        withOverlay(snapshot.session, overlay),
      ),
    };
  };
  /** Per-block change revisions of watched desktop copies, so a watcher
   * fetches only what changed, as for the host's own sessions. */
  const views = new Map<
    string,
    {
      revision: number;
      first: number;
      revs: Map<string, number>;
      json: Map<string, string>;
      bytes: number;
    }
  >();
  const desktopSync = (view: HostSession, client?: number): SessionSync => {
    const id = view.session.id;
    let entry = views.get(id);
    if (!entry || entry.revision !== view.revision) {
      const revs = new Map<string, number>();
      const json = new Map<string, string>();
      for (const block of view.session.blocks) {
        const persisted = view.blockRevisions?.[block.id];
        const text = persisted !== undefined ? `revision:${persisted}` : JSON.stringify(block);
        json.set(block.id, text);
        revs.set(
          block.id,
          entry && entry.json.get(block.id) === text ? entry.revs.get(block.id)! : view.revision,
        );
      }
      entry = {
        revision: view.revision,
        first: entry?.first ?? view.revision,
        revs,
        json,
        bytes: [...json].reduce(
          (sum, [blockId, text]) => sum + (blockId.length + text.length) * 2 + 64,
          0,
        ),
      };
      views.delete(id);
      views.set(id, entry);
      if (views.size > MAX_DESKTOP_VIEWS) views.delete(views.keys().next().value!);
      let bytes = [...views.values()].reduce((sum, view) => sum + view.bytes, 0);
      while (bytes > 64 * 1024 * 1024 && views.size) {
        const key = views.keys().next().value!;
        bytes -= views.get(key)!.bytes;
        views.delete(key);
      }
    }
    if (client === view.revision) return { kind: "unchanged", revision: client };
    if (client === undefined || client < entry.first || client > view.revision)
      return { kind: "snapshot", value: view };
    const {
      blockRevisions: _revisions,
      session: { blocks, ...session },
      ...rest
    } = view;
    const revs = entry.revs;
    return {
      kind: "delta",
      base: client,
      value: { ...rest, session },
      blockIds: blocks.map((block) => block.id),
      blocks: blocks.filter((block) => (revs.get(block.id) ?? view.revision) > client),
    };
  };
  /** Like `refresh`, for reads: a running desktop turn just isn't pulled yet. */
  const catchUp = async (
    id: string,
    known?: { updatedAt: number; running: boolean },
    signal?: AbortSignal,
  ) => {
    try {
      await dependencies.refresh(id, known, signal);
    } catch {
      /* the desktop is mid-turn; serve the host copy */
    }
  };
  return { desktopView, readSessionView, viewMemo, buildDesktopView, views, desktopSync, catchUp };
}
