import { useId, useRef, useState } from "react";
import { DatePicker } from "../../../shared/ui/DatePicker";
import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select, type SelectChoice } from "../../../shared/ui/Select";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { RemoteMachine } from "../../connections";
import {
  sprintProjectKey,
  type HostSprint,
  type SprintFields,
  type SprintProjectRef,
} from "../model/hostSprints";
import { dateNumber, dateValue } from "../model/sprintDates";
import "./sprints.css";
import { presentRemoteError } from "../../connections/public/remoteFailure";

/** The server a new sprint is saved on; the caller passes it only when the choice is real. */
export type SprintServerField = {
  value: string;
  options: SelectChoice[];
  onChange: (value: string) => void;
};

/** Create or edit one sprint. The caller owns persistence and revisions; this only collects fields. */
export function SprintEditor({
  sprint,
  projects,
  defaultProjectKey,
  machines = [],
  server,
  onClose,
  onSave,
}: {
  sprint?: HostSprint;
  projects: readonly SprintProjectRef[];
  defaultProjectKey?: string;
  machines?: readonly RemoteMachine[];
  /** "Save on" for a new sprint; an existing sprint stays on the server that holds it. */
  server?: SprintServerField;
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
  // Missing fields are named at the field only after the first save attempt.
  const [attempted, setAttempted] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  // A closed dialog puts the planning server back where it was; only a save keeps the change.
  const initialServer = useRef(server?.value);
  const close = () => {
    if (busy) return;
    if (server && initialServer.current !== undefined && server.value !== initialServer.current)
      server.onChange(initialServer.current);
    onClose();
  };
  const projectLabel = (project: SprintProjectRef) =>
    `${project.name} / ${machines.find((machine) => machine.environmentId === project.environmentId)?.name ?? t("Unavailable server")}`;
  const nameError = !name.trim() ? t("Enter a sprint name.") : undefined;
  const projectError = !selected.length ? t("Choose at least one project.") : undefined;
  const dateError =
    startsAt && endsAt && endsAt <= startsAt
      ? t("The end date must follow the start date.")
      : undefined;
  return (
    <Modal
      title={sprint ? t("Edit sprint") : t("New sprint")}
      onClose={close}
      fitViewport
      closeDisabled={busy}
      footer={
        <ModalActions>
          <Button variant="ghost" type="button" disabled={busy} onClick={close}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {sprint ? t("Save") : t("Create sprint")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="sprint-form"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          setAttempted(true);
          if (nameError || projectError || dateError) return;
          pending.current = true;
          setBusy(true);
          setError(null);
          try {
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
            setError(presentRemoteError(reason, { explicit: true }));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <TextField
          label={t("Name")}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          error={attempted ? nameError : undefined}
          required
          maxLength={160}
          disabled={busy}
          autoFocus
        />
        <TextareaField
          label={t("Goal (optional)")}
          value={goal}
          onChange={(event) => setGoal(event.currentTarget.value)}
          disabled={busy}
          rows={2}
        />
        <div className="sprint-form-row">
          <SearchableSelect
            multiple
            label={t("Projects")}
            placeholder={t("Choose projects")}
            value={selected}
            onChange={setSelected}
            fieldError={attempted ? projectError : undefined}
            options={projects.map((project) => ({
              value: sprintProjectKey(project),
              label: projectLabel(project),
              description: project.cwd,
              keywords: `${project.environmentId} ${project.cwd}`,
            }))}
            disabled={busy}
          />
          <FieldGroup legend={t("Dates (optional)")} layout="row" gap="sm" disabled={busy}>
            <DatePicker
              label={t("Start date")}
              hideLabel
              placeholder={t("Start")}
              value={startsAt}
              onChange={setStartsAt}
              clearable
            />
            <DatePicker
              label={t("End date")}
              hideLabel
              placeholder={t("End")}
              value={endsAt}
              min={startsAt || undefined}
              onChange={setEndsAt}
              error={dateError}
              clearable
            />
          </FieldGroup>
        </div>
        {server && !sprint ? (
          <Select
            label={t("Save on")}
            value={server.value}
            options={server.options}
            onValueChange={server.onChange}
            disabled={busy}
          />
        ) : null}
        <Disclosure
          summary={
            <>
              {t("Capacity")}{" "}
              <Text as="span" size="caption" tone="muted">
                · {t("optional")}
              </Text>
            </>
          }
          defaultOpen={Boolean(
            sprint?.capacityPoints != null || Object.keys(sprint?.projectCapacities ?? {}).length,
          )}
        >
          <NumberField
            label={t("Sprint capacity (points)")}
            description={t("Points are not hours and do not limit running tasks.")}
            value={capacity}
            min={0}
            step={1}
            onChange={(event) => setCapacity(event.currentTarget.value)}
            disabled={busy}
          />
          {projects
            .filter((project) => selected.includes(sprintProjectKey(project)))
            .map((project) => {
              const key = sprintProjectKey(project);
              return (
                <div className="sprint-project-budget" key={key}>
                  <Text as="span" size="inherit" tone="secondary">
                    {projectLabel(project)}
                  </Text>
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
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
