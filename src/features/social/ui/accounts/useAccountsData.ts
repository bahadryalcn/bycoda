import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import { remoteRequest } from "../../../connections/public/connections";
import type { HostProject } from "../../../connections/public/protocol";
import type { SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { presentRemoteError } from "../../../connections/public/remoteFailure";

export type AccountsData = {
  loading: boolean;
  /** A plain sentence when the accounts could not be read. */
  error: string;
  snapshot?: SocialSnapshot;
  projects: HostProject[];
  /** Account ids with a recognized screen waiting for the owner. */
  needsHumanIds: ReadonlySet<string>;
  needsHumanKnown: boolean;
  projectsError: boolean;
  needsHumanError: boolean;
  checkedAt?: number;
  now: number;
  reload(): void;
};

const POLL_MS = 60_000;
// shortcut: the Host request path here sets no per-call deadline, so a round that never settles is abandoned after two intervals, upgrade when remoteRequest has a deadline.
const POLL_STALE_MS = POLL_MS * 2;

/** Whether a poll tick must wait for an earlier round that is still pending. Explicit reloads never consult this. */
export function pollRoundPending(round: { startedAt: number } | undefined, now: number): boolean {
  return round !== undefined && now - round.startedAt < POLL_STALE_MS;
}

/**
 * Accounts, their capabilities, policies and Host flags for the selected Host and project.
 * Reads only while the screen is active, so a retained hidden screen does not poll the Host.
 */
export function useAccountsData(input: {
  client: SocialClient;
  machineId: string;
  projectId?: string;
  active: boolean;
}): AccountsData {
  const { client, machineId, projectId, active } = input;
  const [now, setNow] = useState(Date.now);
  const [checkedAt, setCheckedAt] = useState<number>();
  const [projectsError, setProjectsError] = useState(false);
  const [needsHumanKnown, setNeedsHumanKnown] = useState(false);
  const [needsHumanError, setNeedsHumanError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tick, setTick] = useState(0);
  const pollRound = useRef<{ startedAt: number } | undefined>(undefined);
  const [settled, setSettled] = useState<object>();
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<SocialSnapshot>();
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [needsHumanIds, setNeedsHumanIds] = useState<ReadonlySet<string>>(() => new Set());

  // A new request object marks an explicit reload or scope change as pending until its read settles.
  // Poll ticks do not change it, so background refreshes never show the loading state.
  const request = useMemo(() => ({}), [active, attempt, client, machineId, projectId]);
  const loading = settled !== request && (active || settled === undefined);

  // Refresh health and its time snapshot only while this retained screen is visible.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the account-health refresh timer attached only to the visible retained screen.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!pollRoundPending(pollRound.current, Date.now())) setTick((value) => value + 1);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active]);

  // Host projects change rarely, so they are read on mount, project change or explicit reload only.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    remoteRequest<HostProject[]>(machineId, "projects.list", {}).then(
      (list) => {
        if (alive) {
          setProjects(list);
          setProjectsError(false);
        }
      },
      () => {
        if (alive) setProjectsError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [active, attempt, machineId, projectId]);

  // A round reads the account snapshot and the needs-human list. Reloads and scope changes always start one;
  // a tick starts one only through the pending check above, so rounds do not stack on a slow Host.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const round = { startedAt: Date.now() };
    pollRound.current = round;
    const snapshotRead = client
      .sectionSnapshot({
        section: "accounts",
        ...(projectId ? { projectId } : {}),
      })
      .then(
        (response) => {
          if (!alive) return;
          setSnapshot(response.snapshot);
          if (response.snapshot) setCheckedAt(Date.now());
          setError(response.snapshot ? "" : t("Could not read the accounts. Try again."));
        },
        (reason: unknown) => {
          if (alive && presentRemoteError(reason)) setError(t("Could not reach this computer."));
        },
      )
      .finally(() => {
        if (alive) setSettled(request);
      });
    const needsHumanRead = client.browser.needsHuman.list().then(
      (result) => {
        if (alive) {
          setNeedsHumanIds(new Set(result.items.map((item) => item.accountId)));
          setNeedsHumanKnown(true);
          setNeedsHumanError(false);
        }
      },
      () => {
        if (alive) {
          setNeedsHumanKnown(false);
          setNeedsHumanError(true);
        }
      },
    );
    void Promise.allSettled([snapshotRead, needsHumanRead]).then(() => {
      if (pollRound.current === round) pollRound.current = undefined;
    });
    return () => {
      alive = false;
    };
  }, [active, client, machineId, projectId, request, tick]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    loading,
    error,
    snapshot,
    projects,
    needsHumanIds,
    needsHumanKnown,
    projectsError,
    needsHumanError,
    checkedAt,
    now,
    reload,
  };
}
