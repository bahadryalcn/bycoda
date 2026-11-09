import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../../../../shared/i18n";
import { remoteRequest } from "../../../connections/public/connections";
import type { HostProject, RemoteMachine } from "../../../connections/public/protocol";
import { socialClient, type SocialClient } from "../../model/socialClient";
import type { SocialShellState } from "./screens";
import { pickPreferredMachine, projectIdForCwd, type WorkspaceChoice } from "./workspaceSelection";

const SAVED_HOST_KEY = "bycoda.social.host";

type HostRecord = SocialShellState & {
  /** A snapshot has been read at least once. */
  loaded: boolean;
  projects: HostProject[];
  /** Explicit project choice: a project id, null for "all projects", undefined to follow the cwd. */
  projectId?: string | null;
};

const EMPTY_HOST: HostRecord = {
  loaded: false,
  hostOnline: false,
  unreachable: false,
  aiStopped: false,
  projects: [],
};

function readSavedHost(): string | null {
  try {
    return localStorage.getItem(SAVED_HOST_KEY);
  } catch {
    return null;
  }
}

function writeSavedHost(machineId: string): void {
  try {
    localStorage.setItem(SAVED_HOST_KEY, machineId);
  } catch {
    /* Storage is unavailable: the choice lasts for this session only. */
  }
}

export type SocialWorkspace = {
  machines: RemoteMachine[];
  machineId: string;
  projects: HostProject[];
  projectId?: string;
  /** Null until a Host is known. Screens render only when a client exists. */
  client: SocialClient | null;
  shell: SocialShellState;
  loaded: boolean;
  /** Host discovery failed or no Host is connected. Empty when the workspace is usable. */
  error: string;
  selectWorkspace(choice: WorkspaceChoice): void;
  setAiStopped(stopped: boolean): void;
  retry(): void;
  shellFor(machineId: string): SocialShellState;
  projectFor(machineId: string): string | undefined;
};

/**
 * Workspace of the Social surface: which computer and project are selected, their shell facts
 * (scheduler, AI stop) and the Host's projects. Each Host keeps its own record, so a Host switch
 * restores that Host's choices. Results that arrive for a Host the user already left are dropped.
 */
export function useSocialWorkspace(cwd: string): SocialWorkspace {
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const [authorityId, setAuthorityId] = useState<string | undefined>();
  const [settledAttempt, setSettledAttempt] = useState<number>();
  const [discoveryError, setDiscoveryError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const discovering = settledAttempt !== attempt;
  const [choice, setChoice] = useState<WorkspaceChoice | null>(null);
  const [saved] = useState(readSavedHost);
  const [hosts, setHosts] = useState<Record<string, HostRecord>>({});

  const updateHost = useCallback((machineId: string, patch: Partial<HostRecord>) => {
    setHosts((previous) => ({
      ...previous,
      [machineId]: { ...EMPTY_HOST, ...previous[machineId], ...patch },
    }));
  }, []);

  // Host discovery: runs on mount and on every explicit retry.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      await invoke("local_host_connect").catch(() => undefined);
      const list = await invoke<RemoteMachine[]>("remote_machines");
      const authority = await invoke<{ authorityMachineId?: string }>(
        "social_authority_status",
      ).catch(() => null);
      if (!alive) return;
      setMachines(list);
      setAuthorityId(authority?.authorityMachineId);
      setDiscoveryError(
        list.length
          ? ""
          : t(
              "Connect a bycoda Host for Social Media. The queue does not run while the Host is offline.",
            ),
      );
    };
    load()
      .catch(() => {
        if (alive) setDiscoveryError(t("Could not connect to the bycoda Host."));
      })
      .finally(() => {
        if (alive) setSettledAttempt(attempt);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const preferred = pickPreferredMachine(machines, authorityId, saved);
  const machineId = choice?.machineId ?? preferred?.id ?? "";
  const client = useMemo(() => (machineId ? socialClient(machineId) : null), [machineId]);

  // Projects and the scheduler state of the selected Host.
  useEffect(() => {
    if (!client) return;
    let alive = true;
    remoteRequest<HostProject[]>(machineId, "projects.list", {}).then(
      (list) => {
        if (alive) updateHost(machineId, { projects: list });
      },
      () => undefined,
    );
    client.sectionSnapshot({ section: "accounts", limit: 1 }).then(
      (response) => {
        const snapshot = response.snapshot;
        if (!alive || !snapshot) return;
        updateHost(machineId, {
          loaded: true,
          unreachable: false,
          hostOnline: snapshot.hostOnline,
          aiStopped: snapshot.aiStopped === true,
        });
      },
      () => {
        if (alive) updateHost(machineId, { loaded: true, unreachable: true, hostOnline: false });
      },
    );
    return () => {
      alive = false;
    };
  }, [client, machineId, attempt, updateHost]);

  const shellFor = useCallback(
    (id: string): SocialShellState => {
      const record = hosts[id] ?? EMPTY_HOST;
      return {
        hostOnline: record.hostOnline,
        unreachable: record.unreachable,
        aiStopped: record.aiStopped,
      };
    },
    [hosts],
  );
  const projectFor = useCallback(
    (id: string): string | undefined => {
      const record = hosts[id] ?? EMPTY_HOST;
      if (record.projectId !== undefined) return record.projectId ?? undefined;
      return projectIdForCwd(record.projects, cwd);
    },
    [hosts, cwd],
  );

  const selectWorkspace = useCallback(
    (next: WorkspaceChoice) => {
      setChoice(next);
      updateHost(next.machineId, { projectId: next.projectId ?? null });
      writeSavedHost(next.machineId);
    },
    [updateHost],
  );
  const setAiStopped = useCallback(
    (stopped: boolean) => {
      if (machineId) updateHost(machineId, { aiStopped: stopped });
    },
    [machineId, updateHost],
  );
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const current = hosts[machineId] ?? EMPTY_HOST;
  const error =
    discoveryError ||
    (!discovering && !machineId ? t("Connect a bycoda Host for Social Media.") : "");
  return {
    machines,
    machineId,
    projects: current.projects,
    projectId: projectFor(machineId),
    client,
    shell: shellFor(machineId),
    loaded: current.loaded,
    error,
    selectWorkspace,
    setAiStopped,
    retry,
    shellFor,
    projectFor,
  };
}
