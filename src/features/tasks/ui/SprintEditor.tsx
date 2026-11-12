import { useId, useRef, useState } from "react";
import { DatePicker } from "../../../shared/ui/DatePicker";
import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import {
  sprintProjectKey,
  type HostSprint,
  type SprintFields,
  type SprintProjectRef,
} from "../model/hostSprints";
import { dateNumber, dateValue } from "../model/sprintDates";
import "./sprints.css";

/** Create or edit one sprint. The caller owns persistence and revisions; this only collects fields. */
export function SprintEditor({
  sprint,
  projects,
  defaultProjectKey,
  onClose,
  onSave,
}: {
  sprint?: HostSprint;
  projects: readonly SprintProjectRef[];
  defaultProjectKey?: string;
  onClose: () => void;
  onSave: (fields: SprintFields) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [selected, setSelected] = useState(
    sprint?.projects.map(sprintProjectKey) ?? (defaultProjectKey ? [defaultProjectKey] : []),
  );
  const [startsAt, setStartsAt] = useState(dateValue(sprint?.startsAt));
  const [endsAt, setEndsAt] = useState(dateValue(sprint?.endsAt));
  const [capacity, setCapacity] = useState(sprint?.capacityPoints?.toString() ?? "");
  const [budgets, setBudgets] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(sprint?.projectCapacities ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  return (
    <Modal
      title={sprint ? t("Edit sprint") : t("New sprint")}
      onClose={() => {
        if (!busy) onClose();
      }}
      fitViewport
      footer={
        <ModalActions>
          <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={busy}
            disabled={!name.trim() || !selected.length}
          >
            {t("Save sprint")}
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
            if (!selected.length) throw new Error(t("Choose at least one project."));
            if (startsAt && endsAt && endsAt <= startsAt)
              throw new Error(t("The end date must follow the start date."));
            await onSave({
              name: name.trim(),
              goal: goal.trim() || undefined,
              projects: projects.filter((project) => selected.includes(sprintProjectKey(project))),
              startsAt: dateNumber(startsAt),
              endsAt: dateNumber(endsAt),
              capacityPoints: capacity ? Number(capacity) : null,
              projectCapacities: Object.fromEntries(
                selected
                  .filter((key) => budgets[key]?.trim())
                  .map((key) => [key, Number(budgets[key])]),
              ),
            });
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <TextField
          label={t("Sprint name")}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
          maxLength={160}
          disabled={busy}
          autoFocus
        />
        <TextareaField
          label={t("Sprint goal")}
          value={goal}
          onChange={(event) => setGoal(event.currentTarget.value)}
          disabled={busy}
          rows={2}
        />
        <SearchableSelect
          multiple
          label={t("Projects")}
          value={selected}
          onChange={setSelected}
          options={projects.map((project) => ({
            value: sprintProjectKey(project),
            label: project.name,
            description: project.cwd,
            keywords: `${project.environmentId} ${project.cwd}`,
          }))}
          disabled={busy}
        />
        <section className="sprint-form-section">
          <SectionLabel>{t("Schedule")}</SectionLabel>
          <div className="sprint-form-grid">
            <DatePicker
              label={t("Start date")}
              value={startsAt}
              onChange={setStartsAt}
              disabled={busy}
            />
            <DatePicker
              label={t("End date")}
              value={endsAt}
              min={startsAt || undefined}
              onChange={setEndsAt}
              disabled={busy}
            />
          </div>
        </section>
        <section className="sprint-form-section">
          <SectionLabel>{t("Capacity")}</SectionLabel>
          <NumberField
            label={t("Sprint capacity (points)")}
            value={capacity}
            min={0}
            step={1}
            onChange={(event) => setCapacity(event.currentTarget.value)}
            disabled={busy}
          />
          {selected.length ? (
            <Disclosure summary={t("Project capacity budgets")}>
              {projects
                .filter((project) => selected.includes(sprintProjectKey(project)))
                .map((project) => {
                  const key = sprintProjectKey(project);
                  return (
                    <div className="sprint-project-budget" key={key}>
                      <span>{project.name}</span>
                      <NumberField
                        label={t("Capacity for {p0}", { p0: project.name })}
                        hideLabel
                        min={0}
                        step={1}
                        value={budgets[key] ?? ""}
                        onChange={(event) =>
                          setBudgets((value) => ({ ...value, [key]: event.currentTarget.value }))
                        }
                        disabled={busy}
                      />
                    </div>
                  );
                })}
            </Disclosure>
          ) : null}
        </section>
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
