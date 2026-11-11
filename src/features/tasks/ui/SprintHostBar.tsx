import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { RefreshCw } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { SprintBoardController } from "../model/sprintClient";
import "./sprints.css";

/**
 * One slim row for the planning Host (when several can plan) and refresh, with the
 * errors the board or the last action reported directly under it.
 */
export function SprintHostBar({
  board,
  busy,
  error,
  showRefresh,
}: {
  board: SprintBoardController;
  busy: boolean;
  error: string | null;
  showRefresh: boolean;
}) {
  const t = useT();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Several Hosts can plan; with one, the choice would only be noise.
  const hostChoices = new Set(board.machines.map((machine) => machine.environmentId));
  const showHost = hostChoices.size > 1 || (!board.coordinator && !!board.coordinatorEnvironmentId);
  const message = error || board.error || refreshError;
  return (
    <>
      {showHost || showRefresh || message ? (
        <div className="sprint-context">
          {showHost ? <span className="sprint-context-label">{t("Planning Host")}</span> : null}
          {showHost ? (
            <div className="sprint-source">
              <SearchableSelect
                hideLabel
                label={t("Planning Host")}
                value={board.coordinatorEnvironmentId}
                options={[
                  ...(!board.coordinator && board.coordinatorEnvironmentId
                    ? [
                        {
                          value: board.coordinatorEnvironmentId,
                          label: t("Selected Host is unavailable"),
                          disabled: true,
                        },
                      ]
                    : []),
                  ...[
                    ...new Map(
                      board.machines.map((machine) => [machine.environmentId, machine]),
                    ).values(),
                  ].map((machine) => ({
                    value: machine.environmentId,
                    label: machine.name,
                  })),
                ]}
                onChange={board.setCoordinatorEnvironmentId}
                disabled={busy}
              />
            </div>
          ) : null}
          {showRefresh ? (
            <Button
              variant="ghost"
              startIcon={<RefreshCw className="icon-xs" />}
              loading={board.loading}
              onClick={() => {
                setRefreshError(null);
                board.refresh().catch((reason: unknown) => {
                  setRefreshError(reason instanceof Error ? reason.message : String(reason));
                });
              }}
            >
              {t("Refresh")}
            </Button>
          ) : null}
          {message ? <InlineError className="sprint-host-error">{message}</InlineError> : null}
        </div>
      ) : null}
      {board.syncErrors.length ? (
        <div>
          <InlineError className="sprint-host-error">
            {t("Some machines need synchronization")}
          </InlineError>
          <ul className="sprint-errors">
            {board.syncErrors.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
