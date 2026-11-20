import {
  inboxOperationWrites,
  parseRemoteInboxOperation,
} from "../../src/features/inbox/model/remoteInbox";
import { TimeoutError, withTimeout } from "../../src/shared/lib/withTimeout";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostInbox } from "../notes/host-notes";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleInboxRpc(
  dependencies: Pick<
    ServerBindings,
    "providerInbox" | "engine" | "projectSessionList" | "tasks" | "goals" | "automations" | "social"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "inbox.provider.status":
      request.result = await dependencies.providerInbox.availability();
      break;

    case "inbox.provider.request": {
      const operation = parseRemoteInboxOperation(
        request.params,
        await dependencies.engine.store.projects(),
      );
      if (
        inboxOperationWrites(operation) &&
        request.params.confirm !==
          (operation.action === "comment"
            ? "SEND_COMMENT"
            : operation.action === "reviewers"
              ? "CHANGE_PR_REVIEWERS"
              : operation.action === "labels"
                ? "CHANGE_PR_LABELS"
                : operation.action === "reaction"
                  ? "CHANGE_PR_REACTION"
                  : operation.action === "review"
                    ? "SUBMIT_PR_REVIEW"
                    : operation.action === "jira-board-transition" ||
                        operation.action === "jira-board-move"
                      ? "CHANGE_JIRA_BOARD"
                      : "CHANGE_PR_STATE")
      )
        throw new Error("This inbox write requires an explicit owner action.");
      request.result = await dependencies.providerInbox.request(
        request.tokenHash,
        request.params.requestId,
        operation,
        await request.domainContext.requesterName?.(),
      );
      break;
    }

    case "inbox.provider.result":
      request.result = await dependencies.providerInbox.result(
        request.tokenHash,
        request.params.requestId,
      );
      break;

    case "inbox.list": {
      const projectId =
        request.params.projectId === undefined ? undefined : String(request.params.projectId);
      const { sources, unavailableProjectIds } = await sharedInboxSources(dependencies, projectId);
      if (!(await dependencies.engine.store.authenticated(request.token)))
        throw new Error("Session authority revoked.");
      request.result = {
        ...hostInbox(sources, projectId),
        // A project whose session list missed its deadline is absent, not empty.
        ...(unavailableProjectIds.length ? { unavailableProjectIds } : {}),
      };
      break;
    }
  }
}

type InboxDependencies = Pick<
  ServerBindings,
  "engine" | "projectSessionList" | "tasks" | "goals" | "automations" | "social"
>;
type InboxSources = Parameters<typeof hostInbox>[0];
type InboxRead = { sources: InboxSources; unavailableProjectIds: string[] };
type ProjectSessionLists = Awaited<ReturnType<InboxDependencies["projectSessionList"]>>;

/** One project's session list may not hold the whole inbox: past this it is left out. */
export const INBOX_PROJECT_LIST_TIMEOUT_MS = 10_000;
/** How long a complete read is reused while no store change signal moved. Desktop-watched
 * sessions and social providers report no store signal, so this also bounds their staleness. */
export const INBOX_READ_TTL_MS = 2_000;
const INBOX_CACHE_LIMIT = 32;

type InboxEntry = {
  /** Store change signals sampled before the read started; any movement ends reuse. */
  stamp: string;
  startedAt: number;
  read: Promise<InboxRead>;
  /** Set only for a complete result; a degraded or failed read is never reused. */
  reusable: boolean;
};
type InboxHostState = {
  entries: Map<string, InboxEntry>;
  /** Project lists still running, so a hung list is joined instead of started again per poll. */
  projectLists: Map<string, { startedAt: number; list: Promise<ProjectSessionLists> }>;
};
/** Per Host. Every client asks at once after a Host restart, and one read lists every
 * project's sessions, so callers on the same store signals share one read. */
const inboxStates = new WeakMap<object, InboxHostState>();

function storeStamp(store: InboxDependencies["engine"]["store"]): string {
  return [store.changeVersion, store.db.dataMutationVersion, store.projectRegistryVersion].join(
    ":",
  );
}

function sharedInboxSources(
  dependencies: InboxDependencies,
  projectId: string | undefined,
): Promise<InboxRead> {
  let state = inboxStates.get(dependencies.engine);
  if (!state)
    inboxStates.set(dependencies.engine, (state = { entries: new Map(), projectLists: new Map() }));
  const { entries } = state;
  const key = projectId ?? "";
  const stamp = storeStamp(dependencies.engine.store);
  const current = entries.get(key);
  if (
    current &&
    current.stamp === stamp &&
    (!current.reusable || elapsedSince(current.startedAt) < INBOX_READ_TTL_MS)
  ) {
    // Re-insert so the size cap drops the least recently used scope.
    entries.delete(key);
    entries.set(key, current);
    return current.read;
  }
  const entry: InboxEntry = {
    stamp,
    startedAt: monotonicNow(),
    reusable: false,
    read: readInboxSources(dependencies, state, projectId),
  };
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > INBOX_CACHE_LIMIT) entries.delete(entries.keys().next().value!);
  entry.read.then(
    ({ unavailableProjectIds }) => {
      if (unavailableProjectIds.length === 0) entry.reusable = true;
      else if (entries.get(key) === entry) entries.delete(key);
    },
    () => {
      // A failed read is never cached; the next caller reads again.
      if (entries.get(key) === entry) entries.delete(key);
    },
  );
  return entry.read;
}

function projectSessionLists(
  dependencies: InboxDependencies,
  state: InboxHostState,
  projectId: string,
): Promise<ProjectSessionLists> {
  const running = state.projectLists.get(projectId);
  // A list older than its deadline is abandoned by every caller; never join it forever.
  if (running && elapsedSince(running.startedAt) < INBOX_PROJECT_LIST_TIMEOUT_MS)
    return running.list;
  const started = dependencies.projectSessionList(projectId);
  const entry = { startedAt: monotonicNow(), list: started };
  state.projectLists.set(projectId, entry);
  const clear = () => {
    if (state.projectLists.get(projectId) === entry) state.projectLists.delete(projectId);
  };
  started.then(clear, clear);
  return started;
}

async function readInboxSources(
  dependencies: InboxDependencies,
  state: InboxHostState,
  projectId: string | undefined,
): Promise<InboxRead> {
  const projects = projectId
    ? [await dependencies.engine.store.project(projectId)]
    : await dependencies.engine.store.projects();
  // The other sources do not depend on the project lists; read them alongside.
  const others = Promise.all([
    dependencies.tasks.list(),
    dependencies.goals.list(),
    dependencies.automations.list(),
    dependencies.social.snapshot({ kind: "owner", actorId: "device", provider: "owner" }),
  ]);
  // Bounded fan-out: with 100+ projects an unbounded Promise.all queues every
  // list job (and its desktop read) at once and starves the point reads.
  const lists: ProjectSessionLists["list"][] = [];
  const unavailableProjectIds: string[] = [];
  let nextProject = 0;
  const listing = Promise.all(
    Array.from({ length: Math.min(4, projects.length) }, async () => {
      for (;;) {
        const index = nextProject++;
        if (index >= projects.length) return;
        const { id } = projects[index];
        try {
          lists[index] = (
            await withTimeout(
              projectSessionLists(dependencies, state, id),
              INBOX_PROJECT_LIST_TIMEOUT_MS,
              "Inbox session list",
            )
          ).list;
        } catch (error) {
          // Only a missed deadline degrades; a refusal or storage failure still fails the read.
          if (!(error instanceof TimeoutError)) throw error;
          lists[index] = [];
          unavailableProjectIds.push(id);
        }
      }
    }),
  );
  // Both start before either is awaited, so neither failure goes unhandled.
  const [[tasks, goals, automations, social]] = await Promise.all([others, listing]);
  return {
    sources: {
      sessions: lists.flat(),
      tasks,
      goals,
      automations,
      threads: social.threads,
    },
    unavailableProjectIds: unavailableProjectIds.sort(),
  };
}
