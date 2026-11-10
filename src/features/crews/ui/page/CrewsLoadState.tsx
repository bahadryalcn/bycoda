import type { ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Alert } from "../../../../shared/ui/Alert";
import { Button } from "../../../../shared/ui/Button";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import type { ProjectCrews, useProjectCrews } from "../../model/crewClient";

type CrewState = ReturnType<typeof useProjectCrews>;

function RetryAlert({ state }: { state: CrewState }) {
  return (
    <Alert
      tone="warning"
      action={
        <Button variant="secondary" loading={state.isFetching} onClick={() => void state.refetch()}>
          {t("Retry")}
        </Button>
      }
    >
      {state.error?.message}
    </Alert>
  );
}

/** Loading, error and no-project states around the crew data; a failed refresh keeps the last list. */
export function CrewsLoadState({
  state,
  noProject,
  children,
}: {
  state: CrewState;
  noProject: boolean;
  children: (data: ProjectCrews) => ReactNode;
}) {
  const data = state.data;
  if (!data)
    return (
      <div className="p-4">
        {state.error ? (
          <RetryAlert state={state} />
        ) : noProject ? (
          // The query is disabled without a real project folder: say so instead of loading forever.
          <Alert tone="info">{t("Open a project to manage its crews.")}</Alert>
        ) : (
          <LoadingText>{t("Loading crews…")}</LoadingText>
        )}
      </div>
    );
  return (
    <>
      {state.error ? (
        <div className="px-4 pt-4">
          <RetryAlert state={state} />
        </div>
      ) : null}
      {children(data)}
    </>
  );
}
