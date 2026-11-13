import { useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { Plus } from "../../../../shared/ui/icons";
import { Modal } from "../../../../shared/ui/Modal";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialList } from "../../model/audience";
import type { EmailAccount, Sequence, SequenceStep } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { LabeledSelect } from "./LabeledSelect";
import { errorMessage } from "./audienceModel";
import { useFormFooter, useTouched } from "./formFooter";
import { SequenceStepEditor, newStepDraft, type StepDraft } from "./SequenceStepEditor";

export type SequenceEditorProps = {
  client: SocialClient;
  sequence?: Sequence;
  lists: readonly SocialList[];
  onClose: () => void;
  onSaved: (sequence: Sequence) => void;
};

const MAX_STEPS = 10;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toDraft(step: SequenceStep): StepDraft {
  return {
    id: step.id,
    channel: step.channel,
    accountId: step.accountId ?? "",
    delayHours: String(step.delayHours),
    template: step.template,
    variants: step.variants ?? [],
    personalize: step.personalize,
  };
}

function numberOf(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/** Steps, timing and pacing of one sequence. The sequence stops for a person as soon as they reply. */
export function SequenceEditor({ client, sequence, lists, onClose, onSaved }: SequenceEditorProps) {
  const [name, setName] = useState(sequence?.name ?? "");
  const [listId, setListId] = useState(sequence?.listId ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    sequence ? sequence.steps.map(toDraft) : [newStepDraft(newId("step"))],
  );
  const [perHour, setPerHour] = useState(String(sequence?.pacing.perHour ?? 10));
  const [perDay, setPerDay] = useState(String(sequence?.pacing.perDay ?? 50));
  const [warmupDays, setWarmupDays] = useState(String(sequence?.pacing.warmupDays ?? 3));
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { touched, touch } = useTouched();

  useEffect(() => {
    let active = true;
    client.email.accounts
      .list()
      .then((result) => {
        if (active) setEmailAccounts(result.items);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [client]);

  const staticLists = lists.filter((list) => list.kind === "static");
  const hourValid = Number.isInteger(numberOf(perHour)) && numberOf(perHour) >= 1;
  const dayValid = Number.isInteger(numberOf(perDay)) && numberOf(perDay) >= 1;
  const warmupValid = Number.isInteger(numberOf(warmupDays)) && numberOf(warmupDays) >= 0;
  const stepProblem = steps.some(
    (step) =>
      !step.template.trim() ||
      Number.isNaN(numberOf(step.delayHours)) ||
      numberOf(step.delayHours) < 0 ||
      (step.channel === "email" && !step.accountId),
  )
    ? t("Each step needs a message, a wait time and, for email, an account.")
    : undefined;
  // Email steps must carry an unsubscribe link; an account still loading is left to the Host.
  const unsubscribeMissing = steps.some((step) => {
    if (step.channel !== "email") return false;
    const account = emailAccounts.find((item) => item.id === step.accountId);
    return account !== undefined && !account.unsubscribeUrl;
  });
  const reason = !name.trim()
    ? t("Enter a name for the sequence.")
    : !listId
      ? t("Choose the list of people it runs for.")
      : !steps.length
        ? t("Add at least one step.")
        : stepProblem
          ? stepProblem
          : unsubscribeMissing
            ? t("Email steps need an unsubscribe link. Add one to this email account first.")
            : !hourValid || !dayValid || !warmupValid
              ? t(
                  "Pacing needs whole numbers: at least 1 per hour and per day, 0 or more warm-up days.",
                )
              : undefined;
  const nameReason = name.trim() ? undefined : t("Enter a name for the sequence.");
  const listReason = listId ? undefined : t("Choose the list of people it runs for.");

  function updateStep(index: number, next: StepDraft) {
    setSteps((current) => current.map((step, position) => (position === index ? next : step)));
  }

  async function save() {
    if (reason) return;
    const payload: SequenceStep[] = steps.map((step) => ({
      id: step.id,
      channel: step.channel,
      ...(step.channel === "email" ? { accountId: step.accountId } : {}),
      delayHours: numberOf(step.delayHours),
      template: step.template.trim(),
      ...(step.variants.length
        ? {
            variants: step.variants
              .filter((variant) => variant.text.trim())
              .map((variant) => ({ ...variant, text: variant.text.trim() })),
          }
        : {}),
      personalize: step.personalize,
    }));
    setSaving(true);
    setError(undefined);
    try {
      const saved = await client.sequences.save({
        ...(sequence ? { id: sequence.id, status: sequence.status } : {}),
        name: name.trim(),
        listId,
        steps: payload,
        pacing: {
          perHour: numberOf(perHour),
          perDay: numberOf(perDay),
          warmupDays: numberOf(warmupDays),
        },
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const footer = useFormFooter({
    saving,
    error,
    blockedReason: reason,
    saveLabel: t("Save sequence"),
    onSave: () => void save().catch((err: unknown) => setError(errorMessage(err))),
    onCancel: onClose,
  });

  return (
    <Modal
      title={sequence ? t("Edit sequence") : t("New sequence")}
      description={t("A reply always ends the sequence for that person.")}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
      {...footer}
    >
      <div className="audience-stack">
        <div className="audience-pair">
          <TextField
            label={t("Sequence name")}
            value={name}
            disabled={saving}
            error={touched("name") ? nameReason : undefined}
            onBlur={() => touch("name")}
            onChange={(event) => setName(event.target.value)}
          />
          <LabeledSelect
            label={t("People")}
            value={listId}
            disabled={saving}
            error={touched("list") ? listReason : undefined}
            options={[
              { value: "", label: t("Choose a list") },
              ...staticLists.map((list) => ({ value: list.id, label: list.name })),
            ]}
            onChange={(value) => {
              touch("list");
              setListId(value);
            }}
          />
        </div>

        <SectionLabel count={steps.length}>{t("Steps")}</SectionLabel>
        {steps.map((step, index) => (
          <SequenceStepEditor
            key={step.id}
            index={index}
            step={step}
            emailAccounts={emailAccounts}
            disabled={saving}
            onChange={(next) => updateStep(index, next)}
            onRemove={() =>
              setSteps((current) => current.filter((_, position) => position !== index))
            }
          />
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Plus className="icon-sm" aria-hidden="true" />}
            disabled={saving || steps.length >= MAX_STEPS}
            onClick={() => setSteps((current) => [...current, newStepDraft(newId("step"))])}
          >
            {t("Add step")}
          </Button>
        </div>

        <FieldGroup legend={t("Pace")} variant="card" layout="row">
          <div className="audience-triple">
            <NumberField
              label={t("Most messages per hour")}
              min={1}
              value={perHour}
              disabled={saving}
              error={hourValid ? undefined : t("Enter a whole number, 1 or more.")}
              onChange={(event) => setPerHour(event.target.value)}
            />
            <NumberField
              label={t("Most messages per day")}
              min={1}
              value={perDay}
              disabled={saving}
              error={dayValid ? undefined : t("Enter a whole number, 1 or more.")}
              onChange={(event) => setPerDay(event.target.value)}
            />
            <NumberField
              label={t("Warm-up days")}
              min={0}
              value={warmupDays}
              disabled={saving}
              error={warmupValid ? undefined : t("Enter a whole number, 0 or more.")}
              onChange={(event) => setWarmupDays(event.target.value)}
            />
          </div>
        </FieldGroup>
      </div>
    </Modal>
  );
}
