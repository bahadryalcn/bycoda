import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import type { SprintBoardController } from "../model/sprintClient";
import "./sprints.css";

/**
 * The server a new sprint is saved on. It is offered only when several servers can plan, or when
 * the remembered one cannot be read (it then stays visible as a disabled entry).
 */
export function sprintServerChoice(
  board: Pick<
    SprintBoardController,
    "machines" | "coordinator" | "coordinatorEnvironmentId" | "setCoordinatorEnvironmentId"
  >,
  unavailableLabel: string,
) {
  const machines = [
    ...new Map(board.machines.map((machine) => [machine.environmentId, machine])).values(),
  ];
  const missing = !board.coordinator && !!board.coordinatorEnvironmentId;
  return {
    show: machines.length > 1 || missing,
    value: board.coordinatorEnvironmentId,
    options: [
      ...(missing
        ? [{ value: board.coordinatorEnvironmentId, label: unavailableLabel, disabled: true }]
        : []),
      ...machines.map((machine) => ({ value: machine.environmentId, label: machine.name })),
    ],
    onChange: board.setCoordinatorEnvironmentId,
  };
}

/** The errors the board or the last action reported, shown once under the page header. */
export function SprintHostBar({
  board,
  error,
}: {
  board: Pick<SprintBoardController, "syncErrors">;
  error: string | null;
}) {
  const t = useT();
  return (
    <>
      {error ? <InlineError>{error}</InlineError> : null}
      {board.syncErrors.length ? (
        <InlineError details={board.syncErrors.join("\n")}>
          {t("Some machines need synchronization")}
        </InlineError>
      ) : null}
    </>
  );
}
