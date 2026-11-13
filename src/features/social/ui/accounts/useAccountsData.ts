import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../../../../shared/i18n";
import { remoteRequest } from "../../../connections/public/connections";
import type { HostProject } from "../../../connections/public/protocol";
import type { SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";

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
  const [settled, setSettled] = useState<object>();
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<SocialSnapshot>();
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [needsHumanIds, setNeedsHumanIds] = useState<ReadonlySet<string>>(() => new Set());

  // A new request object marks every reload as pending until its read settles.
  const request = useMemo(() => ({}), [active, attempt, client, machineId, projectId]);
  const loading = settled !== request && (active || settled === undefined);

  // Refresh health and its time snapshot only while this retained screen is visible.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the account-health refresh timer attached only to the visible retained screen.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      setAttempt((value) => value + 1);
    }, 60_000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    client
      .sectionSnapshot({ section: "accounts", ...(projectId ? { projectId } : {}) })
      .then(
        (response) => {
          if (!alive) return;
          setSnapshot(response.snapshot);
          if (response.snapshot) setCheckedAt(Date.now());
          setError(response.snapshot ? "" : t("Could not read the accounts. Try again."));
        },
        () => {
          if (alive) setError(t("Could not reach this computer."));
        },
      )
      .finally(() => {
        if (alive) setSettled(request);
      });
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
    client.browser.needsHuman.list().then(
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
    return () => {
      alive = false;
    };
  }, [active, request, client, machineId, projectId]);

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
