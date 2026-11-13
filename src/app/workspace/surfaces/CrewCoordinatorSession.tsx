import { useEffect, useState } from "react";
import type { BackgroundSessionTarget } from "../../../features/tasks/model/backgroundSession";
import { useSessionsSelector } from "../../../features/sessions/model/sessionsStore";
import { SessionPane } from "../../../features/sessions/ui/SessionPane";
import { remoteRequest, remoteSessionFor } from "../../../features/connections/model/connections";
import { crewManagedSession } from "../../../features/crews/public/managed";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { Alert } from "../../../shared/ui/Alert";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { t } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { WorkspaceSessionPaneProps } from "../layout/WorkspaceMainArea";
import {
  remoteSessionOwnershipKey,
  reserveSessionWindow,
} from "../../model/sessionWindowOwnership";
import { parseRemotePath } from "../../../features/connections/model/remoteProjects";

/** The app supplies its canonical session store and all normal composer handlers. */
export function CrewCoordinatorSession({
  target,
  paneProps,
  onOpen,
}: {
  target: BackgroundSessionTarget;
  paneProps: WorkspaceSessionPaneProps;
  onOpen: (target: BackgroundSessionTarget) => void | Promise<void>;
}) {
  const session = useSessionsSelector((sessions) =>
    sessions.find(
      (entry) =>
        sameProjectPath(entry.cwd, target.cwd) &&
        (entry.id === target.sessionId || remoteSessionFor(entry.id) === target.sessionId),
    ),
  );
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const { confirm, dialog } = useConfirm();
  const load = useStableCallback(() => onOpen(target));
  const stop = async (sessionId: string) => {
    const managed = crewManagedSession(sessionId);
    if (!managed) {
      paneProps.onStop(sessionId);
      return;
    }
    if (managed.role !== "coordinator") return;
    if (
      !(await confirm({
        title: t("Stop work"),
        message: t("Stop work and cancel running assignments"),
        confirmLabel: t("Stop work"),
      }))
    )
      return;
    await remoteRequest(
      target.machineId,
      "crews.stop",
      { projectId: target.projectId, runId: managed.runId },
      false,
      true,
    );
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Holds the exact conversation's native window reservation until this embedded surface unmounts.
  useEffect(() => {
    let alive = true;
    let release: ((retain?: boolean) => Promise<void>) | undefined;
    const adopt = async () => {
      const key = parseRemotePath(target.cwd)
        ? remoteSessionOwnershipKey(target.cwd, target.sessionId)
        : target.sessionId;
      const finish = await reserveSessionWindow([key]);
      if (!finish) throw new Error("This conversation is already open in another window.");
      if (!alive) {
        await finish(false);
        return;
      }
      release = finish;
      await load();
      if (alive) setLoaded(true);
    };
    void adopt().catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      alive = false;
      if (release)
        void release(false).catch((reason: unknown) =>
          console.error("Crew conversation ownership release failed", reason),
        );
    };
  }, [target.cwd, target.machineId, target.projectId, target.sessionId, revision, load]);
  if (error)
    return (
      <Alert
        tone="danger"
        action={
          <Button
            onClick={() => {
              setError(undefined);
              setRevision(revision + 1);
            }}
          >
            {t("Retry")}
          </Button>
        }
      >
        {error}
      </Alert>
    );
  if (!loaded || !session) return <LoadingText>{t("Loading conversation…")}</LoadingText>;
  return (
    <>
      {dialog}
      <SessionPane
        {...paneProps}
        onStop={(sessionId) => {
          void stop(sessionId).catch((reason: unknown) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          );
        }}
        session={session}
        embedded
        crewCoordinatorChat
        visible
        focused
        inSplit={false}
        composerFocused={false}
        composerFocusToken={0}
      />
    </>
  );
}
