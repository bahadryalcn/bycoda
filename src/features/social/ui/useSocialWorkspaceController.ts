import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";
import {
  createRefreshScheduler,
  type RefreshScheduler,
} from "../../automations/model/refreshScheduler";
import { socialClient, type SocialClient } from "../model/socialClient";
import type {
  SocialCollection,
  SocialCollectionFilter,
  SocialSnapshot,
  SocialWorkspaceFilters,
  SocialWorkspaceQuery,
  SocialWorkspaceResponse,
} from "../model/social";
import { scopeSocialSnapshot } from "../model/socialWorkspace";
import type { Run } from "./socialShared";

export type Tab =
  | "Today"
  | "Accounts"
  | "Campaigns"
  | "Inbox"
  | "Audience"
  | "Automations"
  | "Activity"
  | "Settings";
export type Section = NonNullable<SocialWorkspaceQuery["section"]>;

export function workspaceSection(tab: Tab, automationMode: string): Section {
  if (tab === "Automations")
    return (
      (
        { publish: "plans", reply: "rules", history: "history", sending: "sending" } as Record<
          string,
          Section
        >
      )[automationMode] ?? "plans"
    );
  return (
    {
      Activity: "history",
      // Today composes its own reads; the shared snapshot only supplies accounts and Host state.
      Today: "accounts",
      Accounts: "accounts",
      Campaigns: "campaigns",
      Inbox: "inbox",
      Audience: "audience",
      Settings: "settings",
    } as const
  )[tab];
}

/** Everything the Social view retains for one Host while another Host is shown. */
export type HostWorkspaceState = {
  machineId: string;
  snapshots: Map<Section, SocialSnapshot>;
  cursors: Map<string, SocialWorkspaceResponse>;
  projects: HostProject[];
  projectsLoaded: boolean;
  snapshot: SocialSnapshot | null;
  tab: Tab;
  visited: Tab[];
  filter: string;
  offsets: SocialWorkspaceQuery["offsets"];
  automationMode: string;
  collectionFilters: Partial<Record<Section, SocialWorkspaceFilters>>;
  client?: SocialClient;
  run?: Run;
};

/** Newest-N cursor retention per Host; the oldest query key is evicted first. */
const MAX_RETAINED_CURSORS = 16;
function retainCursor(
  cursors: Map<string, SocialWorkspaceResponse>,
  key: string,
  value: SocialWorkspaceResponse,
) {
  cursors.set(key, value);
  if (cursors.size > MAX_RETAINED_CURSORS) cursors.delete(cursors.keys().next().value!);
}

/** A Host without the section-scoped workspace read serves one full snapshot for every section. */
const LEGACY_SNAPSHOT_SECTIONS: Section[] = [
  "accounts",
  "campaigns",
  "inbox",
  "audience",
  "plans",
  "rules",
  "history",
  "sending",
  "settings",
];
const UNSUPPORTED_WORKSPACE_READ = "Unsupported social operation";

const actionMessages: Record<string, () => string> = {
  "accounts.create": () => t("Account added. Complete the connection."),
  "accounts.grant": () => t("Project permissions saved."),
  "accounts.pause": () => t("Account run state updated."),
  "accounts.disconnect": () => t("Account disconnected."),
  "campaigns.create": () => t("Campaign draft saved."),
  "campaigns.update": () => t("Campaign updated. Approve the current content again."),
  "campaigns.approve": () => t("Campaign content approved."),
  "campaigns.schedule": () => t("Post queued. Track the result in Activity history."),
  "campaigns.pause": () => t("Campaign run state updated."),
  "contacts.upsert": () => t("Contact details saved."),
  "contacts.import": () => t("Contacts imported."),
  "segments.create": () => t("Contact group created."),
  "replies.draft": () => t("Reply draft ready. Review and approve it."),
  "messages.draft": () => t("Message draft ready. Review and approve it."),
  "comments.draft": () => t("Comment draft ready. Review and approve it."),
  "drafts.update": () => t("Draft updated; the earlier send approval was removed."),
  "drafts.approve": () => t("Draft approved. Ready to send."),
  "replies.send": () => t("Reply queued. Track the send result in Activity history."),
  "messages.send": () => t("Message queued. Track the send result in Activity history."),
  "comments.send": () => t("Comment queued. Track the send result in Activity history."),
  "jobs.cancel": () => t("Queued job cancelled."),
  "jobs.retry": () => t("Failed job queued again."),
  "thread.assign": () => t("Conversation project updated."),
  "policy.update": () => t("Agent and content limits saved."),
  "automations.create": () => t("Reply rule saved. Activate it when you are ready."),
  "automations.activate": () => t("Reply rule activated."),
  "automations.pause": () => t("Reply rule paused."),
};

/**
 * Owns the Social workspace data lifecycle so the view only renders an explicit contract:
 * Host discovery and the active Host, retained per-Host workspaces (section snapshots, query
 * cursors, projects, navigation), the section/filter/offset query, request generations, the
 * single refresh scheduler, the legacy-Host fallback and command settlement
 * (busy / error / notice). Page drafts and selection stay inside the page modules.
 *
 * Invalidation after a confirmed mutation: `run` first awaits the action, then (only while the
 * same Host is still active) runs one immediate, non-interactive scheduler refresh that also
 * reloads the project list (`refresh(id, false, true)`, unchanged from the previous view).
 * `refreshScheduler.refresh()` bumps the scheduler generation, so a read that began before the
 * mutation cannot publish. The refresh keeps the retained query cursor (it is not a forced
 * read); like the previous view it relies on the Host reporting a changed snapshot for that
 * cursor after the mutation, which then replaces the retained one. Only an explicit user refresh/retry is
 * forced and drops the cursor. A failed re-read keeps the previous data with the
 * stale/loadError notice. Per-program TanStack caches (`programs`, `program`, ...)
 * are not touched by the scheduler: they are keyed by `socialQueryScope(client)`, so a Host (or a
 * recreated client) never reads another Host's entries; SocialPrograms/SocialCampaigns refresh
 * them with `setQueryData` from the mutation result and by their own interval/visibility
 * refetch, and the unchanged workspace refresh only feeds them `programProjectId`.
 */
export function useSocialWorkspaceController({
  rootRef,
}: {
  /** Receives initial focus when no workspace is retained; focus returns to the opener on cleanup. */
  rootRef: RefObject<HTMLElement | null>;
}) {
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [tab, setTab] = useState<Tab>("Today");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [visited, setVisited] = useState<Tab[]>(["Today"]);
  const markVisited = (item: Tab) =>
    setVisited((current) => (current.includes(item) ? current : [...current, item]));
  const [automationMode, setAutomationMode] = useState("publish");
  const [filter, setFilter] = useState("");
  const [offsets, setOffsets] = useState<SocialWorkspaceQuery["offsets"]>({});
  const [collectionFilters, setCollectionFilters] = useState<
    Partial<Record<Section, SocialWorkspaceFilters>>
  >({});
  // Mutable per-Host cache: only written by effects and async reads, never read while rendering.
  // `hostViews` is the immutable copy of it that render consumes.
  const hostWorkspaces = useRef(new Map<string, HostWorkspaceState>());
  const [hostViews, setHostViews] = useState<[string, HostWorkspaceState][]>([]);
  // The Host whose retained view state (tab, filters, ...) the current render state belongs to.
  const [readyMachineId, setReadyMachineId] = useState("");
  const publishHosts = useCallback(() => {
    setHostViews(
      Array.from(hostWorkspaces.current.entries(), ([id, host]) => [
        id,
        { ...host, snapshots: new Map(host.snapshots) },
      ]),
    );
  }, []);
  const scheduler = useRef<RefreshScheduler | null>(null);
  const scheduledQuery = useRef("");
  const forceRefresh = useRef(false);
  const refreshProjects = useRef(false);
  const refreshSucceeded = useRef(false);
  const legacyHosts = useRef(new Set<string>());
  const section = workspaceSection(tab, automationMode);
  const query = useRef<SocialWorkspaceQuery>({ section });
  const running = useRef(false);
  const epoch = useRef(0);
  const currentMachine = useRef(machineId);
  const lastAction = useRef("");
  const loadedMachine = useRef("");
  const retainedSnapshot = useRef(snapshot);
  // Latest committed render state for the async readers; layout effects run before the passive
  // effects below, so every effect sees the values of the render it belongs to.
  useLayoutEffect(() => {
    query.current = {
      section,
      ...(filter ? { projectId: filter } : {}),
      offsets,
      filters: collectionFilters[section] ?? {},
    };
    retainedSnapshot.current = snapshot;
    currentMachine.current = machineId;
  });
  const client = useMemo(() => {
    const base = socialClient(readyMachineId);
    const request: typeof base.request = async <T>(
      action: string,
      input?: Record<string, unknown>,
      requestId?: string,
    ) => {
      lastAction.current = action;
      return base.request<T>(action, input, requestId);
    };
    return { ...base, request };
  }, [readyMachineId]);
  const readWorkspace = useCallback(
    async (id: string, isCurrent: () => boolean) => {
      const version = ++epoch.current;
      const host = hostWorkspaces.current.get(id)!;
      const input = query.current;
      const queryKey = JSON.stringify(input);
      const force = forceRefresh.current;
      const withProjects = refreshProjects.current || !host.projectsLoaded;
      forceRefresh.current = false;
      refreshProjects.current = false;
      const base = socialClient(id);
      const read = async (): Promise<SocialWorkspaceResponse> => {
        if (!legacyHosts.current.has(id)) {
          try {
            return await base.workspaceSnapshot(
              {
                ...input,
                ...(force ? {} : { cursor: host.cursors.get(queryKey)?.cursor }),
              },
              force,
            );
          } catch (value) {
            if (!String(value).includes(UNSUPPORTED_WORKSPACE_READ)) throw value;
            legacyHosts.current.add(id);
          }
        }
        return { cursor: "", unchanged: false, snapshot: await base.snapshot() };
      };
      if (force || !retainedSnapshot.current) setRefreshing(true);
      const answers = await Promise.allSettled([
        read(),
        withProjects
          ? remoteRequest<HostProject[]>(id, "projects.list", {}, force)
          : Promise.resolve(host.projects),
      ]);
      if (!isCurrent() || version !== epoch.current || currentMachine.current !== id) return;
      setStale(answers.some((answer) => answer.status === "rejected"));
      if (answers[0].status === "fulfilled") {
        const result = answers[0].value;
        const next = result.snapshot ?? host.cursors.get(queryKey)?.snapshot;
        if (!next) throw new Error(t("The Social Media refresh response is incomplete."));
        retainCursor(host.cursors, queryKey, { ...result, snapshot: next });
        host.snapshot = next;
        if (legacyHosts.current.has(id)) {
          for (const key of LEGACY_SNAPSHOT_SECTIONS) host.snapshots.set(key, next);
        } else host.snapshots.set(input.section!, next);
        publishHosts();
        setSnapshot(next);
        setLoadError("");
        setUpdatedAt(Date.now());
      } else {
        setLoadError(String(answers[0].reason));
      }
      if (answers[1].status === "fulfilled") {
        host.projects = answers[1].value;
        host.projectsLoaded = true;
        setProjects(answers[1].value);
      } else if (answers[0].status === "fulfilled") {
        const reason = answers[1].reason;
        setLoadError(
          t("Project list could not be refreshed: {p0}", {
            p0: reason instanceof Error ? reason.message : String(reason),
          }),
        );
      }
      setLoading(false);
      setRefreshing(false);
      refreshSucceeded.current = answers.every((answer) => answer.status === "fulfilled");
    },
    [publishHosts],
  );
  const refresh = useCallback(async (id: string, interactive = false, withProjects = false) => {
    if (id !== currentMachine.current || !scheduler.current) return false;
    forceRefresh.current ||= interactive;
    refreshProjects.current ||= interactive || withProjects;
    if (interactive) setRefreshing(true);
    await scheduler.current.refresh();
    return id === currentMachine.current && refreshSucceeded.current;
  }, []);
  // Host discovery: runs on mount and on every explicit retry while no Host is connected.
  useEffect(() => {
    let alive = true;
    if (!retainedSnapshot.current) setLoading(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    const load = async () => {
      await invoke("local_host_connect").catch(() => undefined);
      const list = await invoke<RemoteMachine[]>("remote_machines");
      if (!alive) return;
      const authority = await invoke<{ authorityMachineId?: string }>(
        "social_authority_status",
      ).catch(() => null);
      if (!alive) return;
      setMachines(list);
      const saved = localStorage.getItem("bycoda.social.host");
      const preferred =
        list.find((machine) => machine.id === (authority?.authorityMachineId ?? saved)) ??
        list.find(isLocalSyncMachine) ??
        list[0];
      if (preferred) setMachineId(preferred.id);
      else
        setLoadError(
          t(
            "Connect a bycoda Host for Social Media. The queue does not run while the Host is offline.",
          ),
        );
    };
    void load()
      .catch((value) => alive && setLoadError(String(value)))
      .finally(() => alive && setLoading(false));
    if (!retainedSnapshot.current) rootRef.current?.focus();
    return () => {
      alive = false;
      ++epoch.current;
      previousFocus?.focus();
    };
  }, [retryKey]);
  // Active Host: restore its retained workspace and (re)start the one refresh scheduler.
  useEffect(() => {
    if (!machineId) return;
    localStorage.setItem("bycoda.social.host", machineId);
    if (loadedMachine.current !== machineId) {
      loadedMachine.current = machineId;
      let host = hostWorkspaces.current.get(machineId);
      if (!host) {
        host = {
          machineId,
          snapshots: new Map(),
          cursors: new Map(),
          projects: [],
          projectsLoaded: false,
          snapshot: null,
          tab: "Today",
          visited: ["Today"],
          filter: "",
          offsets: {},
          automationMode: "publish",
          collectionFilters: {},
        };
        hostWorkspaces.current.set(machineId, host);
      }
      retainedSnapshot.current = host.snapshot;
      setSnapshot(host.snapshot);
      setProjects(host.projects);
      setFilter(host.filter);
      setOffsets(host.offsets);
      setTab(host.tab);
      setVisited(host.visited);
      setAutomationMode(host.automationMode);
      setCollectionFilters(host.collectionFilters);
      query.current = {
        section: workspaceSection(host.tab, host.automationMode),
        ...(host.filter ? { projectId: host.filter } : {}),
        offsets: host.offsets,
        filters: host.collectionFilters[workspaceSection(host.tab, host.automationMode)] ?? {},
      };
      setError("");
      setLoadError("");
      setNotice("");
      setStale(false);
      setLoading(!host.snapshot);
      setUpdatedAt(0);
      setReadyMachineId(machineId);
      publishHosts();
    }
    scheduledQuery.current = JSON.stringify(query.current);
    const nextScheduler = createRefreshScheduler({
      run: (isCurrent) =>
        document.hidden ? Promise.resolve() : readWorkspace(machineId, isCurrent),
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
    });
    scheduler.current = nextScheduler;
    const onVisibility = () => nextScheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    nextScheduler.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      nextScheduler.stop();
      ++epoch.current;
      if (scheduler.current === nextScheduler) scheduler.current = null;
    };
  }, [machineId, readWorkspace, publishHosts]);
  // Query routing: a changed section/filter/offset/collection filter triggers one scheduler read.
  useEffect(() => {
    const key = JSON.stringify(query.current);
    if (!machineId || scheduledQuery.current === key) return;
    scheduledQuery.current = key;
    setRefreshing(true);
    void refresh(machineId);
  }, [machineId, tab, automationMode, filter, offsets, collectionFilters, refresh]);
  // Command settlement: one global in-flight action; notice/error belong to the Host that ran it.
  const run: Run = async (work, successMessage) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    lastAction.current = "";
    const id = readyMachineId;
    try {
      await work();
      const completedMessage =
        successMessage ??
        actionMessages[lastAction.current]?.() ??
        t("Operation completed; results updated.");
      if (currentMachine.current === id) {
        let fresh = false;
        try {
          fresh = await refresh(id, false, true);
        } catch (cause) {
          setLoadError(cause instanceof Error ? cause.message : String(cause));
        }
        setNotice(
          fresh
            ? completedMessage
            : `${completedMessage} ${t("The list could not be refreshed; showing the latest data.")}`,
        );
      }
      return true;
    } catch (value) {
      if (currentMachine.current === id)
        setError(value instanceof Error ? value.message : String(value));
      return false;
    } finally {
      setBusy(false);
      running.current = false;
    }
  };
  const scoped = useMemo(() => scopeSocialSnapshot(snapshot, filter), [snapshot, filter]);
  // The retained cache keeps the latest view state of the Host that is shown, so it can be restored.
  useLayoutEffect(() => {
    const host = hostWorkspaces.current.get(readyMachineId);
    if (host)
      Object.assign(host, {
        tab,
        visited,
        filter,
        offsets,
        automationMode,
        client,
        run,
        projects,
        collectionFilters,
      });
  });
  // The shown Host renders from live state; the others from their last published view.
  const hosts: [string, HostWorkspaceState][] = hostViews.map(([id, view]) => [
    id,
    id === readyMachineId
      ? {
          ...view,
          tab,
          visited,
          filter,
          offsets,
          automationMode,
          client,
          run,
          projects,
          collectionFilters,
        }
      : view,
  ]);
  const shownHost = hostViews.find(([id]) => id === machineId)?.[1];
  const actions = {
    selectMachine: (id: string) => setMachineId(id),
    selectTab(item: Tab) {
      setNotice("");
      setError("");
      setTab(item);
      markVisited(item);
    },
    /** In-page navigation between destinations; Plans and replies opens on Sharing plans. */
    navigate(next: Tab) {
      if (next === "Automations") setAutomationMode("publish");
      setTab(next);
      markVisited(next);
    },
    openHistory() {
      setTab("Activity");
      setAutomationMode("history");
      setNotice("");
      markVisited("Activity");
    },
    openSending() {
      setTab("Automations");
      setAutomationMode("sending");
      markVisited("Automations");
    },
    setAutomationMode,
    setProjectFilter(next: string) {
      setFilter(next);
      setOffsets({});
    },
    setPage(collection: SocialCollection, offset: number) {
      setOffsets((previous) => ({ ...previous, [collection]: offset }));
    },
    setCollectionFilter(
      targetSection: Section,
      collection: SocialCollection,
      next: SocialCollectionFilter,
    ) {
      setCollectionFilters((previous) => ({
        ...previous,
        [targetSection]: { ...previous[targetSection], [collection]: next },
      }));
      setOffsets((previous) => ({ ...previous, [collection]: 0 }));
    },
    /** Interactive refresh: forces a fresh read of the section and the project list. */
    refreshNow() {
      setNotice("");
      void refresh(machineId, true);
    },
    /** Error bar action: dismisses an operation error, else retries the read or Host discovery. */
    retry() {
      if (error) setError("");
      else if (machineId) void refresh(machineId, true);
      else setRetryKey((value) => value + 1);
    },
    run,
  };
  return {
    machines,
    machineId,
    /** Raw active-Host snapshot (sending/online status); pages receive the retained per-section ones. */
    snapshot,
    /** The snapshot narrowed by the project filter, used for counts and pagination. */
    scoped,
    projects,
    section,
    tab,
    filter,
    status: { loading, refreshing, stale, busy, error, loadError, notice, updatedAt },
    /** Retained workspaces of every Host seen so far (inactive ones stay mounted but hidden). */
    hosts,
    /** False until the active Host answered for the current section. */
    sectionLoaded: !!scoped && !!shownHost?.snapshots.has(section),
    actions,
  };
}
