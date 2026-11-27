import { useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { useMinuteNow } from "../../../../shared/hooks/useMinuteNow";
import { remoteRequest } from "../../../connections/public/connections";
import type { HostProject } from "../../../connections/public/protocol";
import type { SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { usePollingRefresh } from "../../hooks/usePollingRefresh";
import { useRequestToken } from "./useRequestToken";

export type AccountsData = {
  loading: boolean;
  /** A plain sentence when the accounts could not be read. */
  failureTitle: string;
  /** The Host text behind `failureTitle`, for the Details popover. */
  errorDetails?: string;
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
  const now = useMinuteNow(active);
  const [checkedAt, setCheckedAt] = useState<number>();
  const [projectsError, setProjectsError] = useState(false);
  const [needsHumanKnown, setNeedsHumanKnown] = useState(false);
  const [needsHumanError, setNeedsHumanError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<object>();
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string>();
  const [snapshot, setSnapshot] = useState<SocialSnapshot>();
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [needsHumanIds, setNeedsHumanIds] = useState<ReadonlySet<string>>(() => new Set());

  // A new request marks a scope change pending. Background refreshes keep the current rows visible.
  const request = useRequestToken([active, client, machineId, projectId]);
  const loading = settled !== request && (active || settled === undefined);

  // Host projects change rarely, so they are read on mount, project change or explicit reload only.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reads the Host project list while the screen is active; `alive` drops a read that settles after a scope change.
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

  const refresh = usePollingRefresh({
    active,
    scope: request,
    intervalMs: POLL_MS,
    load: async (isCurrent) => {
      const snapshotRead = client
        .sectionSnapshot({
          section: "accounts",
          ...(projectId ? { projectId } : {}),
        })
        .then(
          (response) => {
            if (!isCurrent()) return;
            setSnapshot(response.snapshot);
            if (response.snapshot) setCheckedAt(Date.now());
            setError(response.snapshot ? "" : t("Could not read the accounts. Try again."));
            setErrorDetails(undefined);
            return Boolean(response.snapshot);
          },
          (reason: unknown) => {
            if (isCurrent()) {
              // A connection failure is shown centrally, so its stale sentence must not linger here.
              const raw = presentRemoteError(reason);
              setError(raw ? t("Could not reach this computer.") : "");
              setErrorDetails(raw || undefined);
            }
            return false;
          },
        )
        .finally(() => {
          if (isCurrent()) setSettled(request);
        });
      const needsHumanRead = client.browser.needsHuman.list().then(
        (result) => {
          if (isCurrent()) {
            setNeedsHumanIds(new Set(result.items.map((item) => item.accountId)));
            setNeedsHumanKnown(true);
            setNeedsHumanError(false);
          }
          return true;
        },
        () => {
          if (isCurrent()) {
            setNeedsHumanKnown(false);
            setNeedsHumanError(true);
          }
          return false;
        },
      );
      const [accounts, needsHuman] = await Promise.allSettled([snapshotRead, needsHumanRead]);
      // The needs-human read reports its own failure (needsHumanError); it must not fail the accounts refresh.
      void needsHuman;
      if (accounts.status === "rejected" || !accounts.value) {
        throw new Error("Accounts refresh failed");
      }
    },
  });

  const reload = () => {
    setSettled(undefined);
    setAttempt((value) => value + 1);
    void refresh().catch(() => undefined);
  };
  return {
    loading,
    failureTitle: error,
    errorDetails,
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
