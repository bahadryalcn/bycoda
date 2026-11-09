import { useId, useRef, useState } from "react";
import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { sprintProjectKey, sprintTaskKey, type SprintReport } from "../model/hostSprints";
import type { SprintBoardController } from "../model/sprintClient";
import "./sprints.css";

/** Completing a sprint: freeze the report and optionally roll unfinished tasks over. */
export function SprintCompletion({
  board,
  report,
  onClose,
  onComplete,
}: {
  board: SprintBoardController;
  report: SprintReport;
  onClose: () => void;
  onComplete: (options: {
    rollover?: { taskKeys: string[]; targetSprintId: string | null };
  }) => Promise<void>;
}) {
  const t = useT();
  const unfinished = report.tasks.filter((task) => task.status !== "done" && !task.deleted);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("backlog");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const formId = useId();
  const targets = board.sprints.filter(
    (sprint) =>
      sprint.id !== report.sprint.id &&
      (sprint.state === "planned" || sprint.state === "active") &&
      unfinished
        .filter((task) => selected.includes(sprintTaskKey(task)))
        .every((task) =>
          sprint.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(task)),
        ),
  );
  // A chosen sprint that stops accepting the selected tasks falls back to the
  // backlog; the choice itself stays, so it applies again if it becomes valid.
  const effectiveTarget =
    target !== "backlog" && !targets.some((sprint) => sprint.id === target) ? "backlog" : target;
  return (
    <Modal
      title={t("Complete sprint")}
      onClose={() => {
        if (!busy) onClose();
      }}
      fitViewport
      footer={
        <ModalActions>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" variant="primary" form={formId} loading={busy}>
            {t("Complete sprint")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="sprint-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError(null);
          try {
            await onComplete(
              selected.length
                ? {
                    rollover: {
                      taskKeys: selected,
                      targetSprintId: effectiveTarget === "backlog" ? null : effectiveTarget,
                    },
                  }
                : {},
            );
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <p className="sprint-muted">
          {t(
            "The sprint report will be frozen. Select unfinished tasks to move; other tasks keep their sprint history.",
          )}
        </p>
        {unfinished.length ? (
          <section className="sprint-form-section">
            <SectionLabel count={unfinished.length}>{t("Tasks")}</SectionLabel>
            <ul className="sprint-complete-tasks">
              {unfinished.map((task) => {
                const key = sprintTaskKey(task);
                return (
                  <li key={key}>
                    <Checkbox
                      label={task.title}
                      checked={selected.includes(key)}
                      onChange={(event) =>
                        setSelected((value) =>
                          event.currentTarget.checked
                            ? [...value, key]
                            : value.filter((item) => item !== key),
                        )
                      }
                      disabled={busy}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {selected.length ? (
          <SearchableSelect
            label={t("Move selected tasks to")}
            value={effectiveTarget}
            onChange={setTarget}
            options={[
              { value: "backlog", label: t("Backlog") },
              ...targets.map((sprint) => ({ value: sprint.id, label: sprint.name })),
            ]}
            disabled={busy}
          />
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
