import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { SprintBoardController } from "../model/sprintClient";
import "./sprints.css";

/**
 * One slim row for the planning Host (when several can plan), with the errors the board
 * or the last action reported directly under it.
 */
export function SprintHostBar({
  board,
  busy,
  error,
  onCoordinatorChange,
}: {
  board: SprintBoardController;
  busy: boolean;
  error: string | null;
  onCoordinatorChange?: () => void;
}) {
  const t = useT();
  // Several Hosts can plan; with one, the choice would only be noise.
  const hostChoices = new Set(board.machines.map((machine) => machine.environmentId));
  const showHost = hostChoices.size > 1 || (!board.coordinator && !!board.coordinatorEnvironmentId);
  const message = error || board.error;
  return (
    <>
      {showHost || message ? (
        <Text as="div" size="inherit" tone="secondary" className="sprint-context">
          {showHost ? (
            <div className="sprint-source">
              <SearchableSelect
                hideLabel
                label={t("Sprint server")}
                tooltip={t("Sprint records are saved on this server. Tasks can run on any server.")}
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
                onChange={(value) => {
                  board.setCoordinatorEnvironmentId(value);
                  onCoordinatorChange?.();
                }}
                disabled={busy}
              />
            </div>
          ) : null}
          {message ? <InlineError className="sprint-host-error">{message}</InlineError> : null}
        </Text>
      ) : null}
      {board.syncErrors.length ? (
        <InlineError className="sprint-host-error" details={board.syncErrors.join("\n")}>
          {t("Some machines need synchronization")}
        </InlineError>
      ) : null}
    </>
  );
}
