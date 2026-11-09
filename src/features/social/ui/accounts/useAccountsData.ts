import { useCallback, useEffect, useState } from "react";
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
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<SocialSnapshot>();
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [needsHumanIds, setNeedsHumanIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    client
      .sectionSnapshot({ section: "accounts", ...(projectId ? { projectId } : {}) })
      .then(
        (response) => {
          if (!alive) return;
          setSnapshot(response.snapshot);
          setError(response.snapshot ? "" : t("Could not read the accounts. Try again."));
        },
        () => {
          if (alive) setError(t("Could not reach this computer."));
        },
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    remoteRequest<HostProject[]>(machineId, "projects.list", {}).then(
      (list) => alive && setProjects(list),
      () => undefined,
    );
    client.browser.needsHuman.list().then(
      (result) => alive && setNeedsHumanIds(new Set(result.items.map((item) => item.accountId))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [active, attempt, client, machineId, projectId]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { loading, error, snapshot, projects, needsHumanIds, reload };
}
