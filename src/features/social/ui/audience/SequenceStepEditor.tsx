import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Switch } from "../../../../shared/ui/Switch";
import { TextField } from "../../../../shared/ui/TextField";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import type { EmailAccount, OutreachChannel } from "../../model/outreach";
import { LabeledSelect } from "./LabeledSelect";
import { channelLabel } from "./audienceModel";

export const OUTREACH_CHANNELS: readonly OutreachChannel[] = [
  "dm",
  "comment",
  "mention",
  "email",
  "whatsapp",
  "telegram",
];

export type StepDraft = {
  id: string;
  channel: OutreachChannel;
  /** Email steps only: the email account that sends the step. */
  accountId: string;
  delayHours: string;
  template: string;
  variants: { id: string; text: string }[];
  personalize: boolean;
};

export function newStepDraft(id: string): StepDraft {
  return {
    id,
    channel: "dm",
    accountId: "",
    delayHours: "0",
    template: "",
    variants: [],
    personalize: true,
  };
}

export type SequenceStepEditorProps = {
  index: number;
  step: StepDraft;
  emailAccounts: readonly EmailAccount[];
  disabled: boolean;
  onChange: (step: StepDraft) => void;
  onRemove: () => void;
};

/** One step: channel, wait, message text, optional variants and personalisation. */
export function SequenceStepEditor({
  index,
  step,
  emailAccounts,
  disabled,
  onChange,
  onRemove,
}: SequenceStepEditorProps) {
  const isEmail = step.channel === "email";
  const selectedEmail = emailAccounts.find((account) => account.id === step.accountId);
  return (
    <FieldGroup legend={t("Step {p0}", { p0: index + 1 })} variant="card">
      <div className="audience-stack">
        <LabeledSelect
          label={t("Channel")}
          value={step.channel}
          disabled={disabled}
          options={OUTREACH_CHANNELS.map((channel) => ({
            value: channel,
            label: channelLabel(channel),
          }))}
          onChange={(value) =>
            onChange({ ...step, channel: value as OutreachChannel, accountId: "" })
          }
        />
        {isEmail ? (
          <LabeledSelect
            label={t("Send from")}
            value={step.accountId}
            disabled={disabled || !emailAccounts.length}
            options={[
              { value: "", label: t("Choose an email account") },
              ...emailAccounts.map((account) => ({
                value: account.id,
                label: `${account.name} <${account.from}>`,
              })),
            ]}
            onChange={(accountId) => onChange({ ...step, accountId })}
          />
        ) : null}
        <NumberField
          label={t("Wait before this step (hours)")}
          min={0}
          max={24 * 90}
          value={step.delayHours}
          disabled={disabled}
          onChange={(event) => onChange({ ...step, delayHours: event.target.value })}
        />
        <TextareaField
          label={t("Message")}
          value={step.template}
          minRows={3}
          maxRows={8}
          disabled={disabled}
          onChange={(event) => onChange({ ...step, template: event.target.value })}
        />
        {step.variants.map((variant, position) => (
          <div key={variant.id} className="audience-row">
            <TextField
              label={t("Variant {p0}", { p0: String.fromCharCode(66 + position) })}
              value={variant.text}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...step,
                  variants: step.variants.map((item) =>
                    item.id === variant.id ? { ...item, text: event.target.value } : item,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...step,
                  variants: step.variants.filter((item) => item.id !== variant.id),
                })
              }
            >
              {t("Remove variant")}
            </Button>
          </div>
        ))}
        <div className="audience-row">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || step.variants.length >= 4}
            onClick={() =>
              onChange({
                ...step,
                variants: [
                  ...step.variants,
                  { id: `${step.id}-v${step.variants.length + 1}-${Date.now()}`, text: "" },
                ],
              })
            }
          >
            {t("Add variant")}
          </Button>
          <Switch
            label={t("Personalise each message")}
            checked={step.personalize}
            disabled={disabled}
            onCheckedChange={(personalize) => onChange({ ...step, personalize })}
          />
        </div>
        {isEmail && selectedEmail && !selectedEmail.unsubscribeUrl ? (
          <p className="audience-warning">
            {t("Email steps need an unsubscribe link. Add one to this email account first.")}
          </p>
        ) : null}
        <div>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>
            {t("Remove step")}
          </Button>
        </div>
      </div>
    </FieldGroup>
  );
}
