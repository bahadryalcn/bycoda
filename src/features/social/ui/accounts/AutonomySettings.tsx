import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { TimePicker } from "../../../../shared/ui/TimePicker";
import { useEffect, useState } from "react";
import { getLocale, t } from "../../../../shared/i18n";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";

import { NumberField } from "../../../../shared/ui/NumberField";
import { Select } from "../../../../shared/ui/Select";
import { Switch } from "../../../../shared/ui/Switch";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { ConfirmAutonomy } from "../common/ConfirmAutonomy";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import {
  DEFAULT_AUTONOMY,
  type AutonomyAction,
  type AutonomyLevel,
  type AutonomyPolicy,
} from "../../model/autonomy";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import {
  AUTONOMY_ACTIONS,
  AUTONOMY_LEVELS,
  autonomyLabel,
  defaultTimeZone,
  hasAutonomousLevel,
  levelText,
  parseDailyLimit,
  weekdayLabels,
  workingHoursError,
} from "./accountsModel";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type AutonomySettingsProps = {
  client: SocialClient;
  account: SocialAccount;
  disabled: boolean;
  onChanged(): void;
};

type Hours = {
  enabled: boolean;
  timeZone: string;
  days: number[];
  start: string;
  end: string;
};
type Draft = {
  levels: Record<AutonomyAction, AutonomyLevel>;
  limits: Record<AutonomyAction, string>;
  hours: Hours;
};

function draftFrom(policy: AutonomyPolicy): Draft {
  const limits = Object.fromEntries(
    AUTONOMY_ACTIONS.map((action) => [action, String(policy.limits[action] ?? "")]),
  ) as Record<AutonomyAction, string>;
  const hours = policy.workingHours;
  return {
    levels: { ...policy.levels },
    limits,
    hours: {
      enabled: !!hours,
      timeZone: hours?.timeZone ?? defaultTimeZone(),
      days: hours?.days ?? [1, 2, 3, 4, 5],
      start: hours?.start ?? "09:00",
      end: hours?.end ?? "17:00",
    },
  };
}

/**
 * The Host payload for a draft: the three fields `autonomy.set` accepts. A blank daily limit means
 * the default limit; working hours that are switched off are sent as null, which clears them.
 */
function payloadFrom(draft: Draft): { ok: true; policy: object } | { ok: false; message: string } {
  const limits: Partial<Record<AutonomyAction, number>> = {};
  for (const action of AUTONOMY_ACTIONS) {
    const parsed = parseDailyLimit(draft.limits[action]);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    limits[action] = parsed.value ?? DEFAULT_AUTONOMY.limits[action];
  }
  if (!draft.hours.enabled)
    return { ok: true, policy: { levels: draft.levels, limits, workingHours: null } };
  const problem = workingHoursError(draft.hours);
  if (problem) return { ok: false, message: problem };
  return {
    ok: true,
    policy: {
      levels: draft.levels,
      limits,
      workingHours: {
        timeZone: draft.hours.timeZone.trim(),
        days: [...draft.hours.days].sort((a, b) => a - b),
        start: draft.hours.start,
        end: draft.hours.end,
      },
    },
  };
}

/**
 * How far AI may act for this account, per action. Switching an action to autonomous asks first;
 * limits and working hours apply to every level.
 */
export function AutonomySettings({ client, account, disabled, onChanged }: AutonomySettingsProps) {
  const [policy, setPolicy] = useState<AutonomyPolicy>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const { error, is, write } = useAccountWrite(
    t("The autonomy settings could not be saved. Try again."),
  );
  const confirmation = useConfirm();

  useEffect(() => {
    let alive = true;
    client.autonomy.get(account.id).then(
      (value) => {
        if (!alive) return;
        setPolicy(value);
        setDraft(draftFrom(value));
      },
      () => {
        if (alive) setLoadError(t("The autonomy settings could not be read. Try again."));
      },
    );
    return () => {
      alive = false;
    };
  }, [account.id, client]);

  if (!policy || !draft) {
    return (
      <section
        {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
        aria-label={t("Autonomy")}
      >
        {loadError ? (
          <InlineError>{loadError}</InlineError>
        ) : (
          <LoadingText delay={false} className="social-muted">
            {t("Loading…")}
          </LoadingText>
        )}
      </section>
    );
  }

  const built = payloadFrom(draft);
  const saved = payloadFrom(draftFrom(policy));
  const changed =
    !saved.ok || !built.ok || JSON.stringify(built.policy) !== JSON.stringify(saved.policy);
  const saveGate: ActionGate = disabled
    ? { disabled: true, disabledReason: t("Connect to this computer to change this account.") }
    : !changed
      ? { disabled: true, disabledReason: t("No changes to save.") }
      : { disabled: false };

  const askLevel = (action: AutonomyAction, next: AutonomyLevel) => {
    if (next !== "autonomous") {
      setDraft({ ...draft, levels: { ...draft.levels, [action]: next } });
      return;
    }
    const parsed = parseDailyLimit(draft.limits[action]);
    void confirmation
      .confirm({
        title: t("Let AI {p1} on {p2} without asking?", {
          p1: autonomyLabel(action).toLowerCase(),
          p2: account.name,
        }),
        message: (
          <ConfirmAutonomy
            accountName={account.name}
            action={action}
            level={next}
            dailyLimit={
              parsed.ok && parsed.value !== undefined
                ? parsed.value
                : DEFAULT_AUTONOMY.limits[action]
            }
          />
        ),
        confirmLabel: t("Allow autonomous"),
      })
      .then((ok) => {
        if (ok)
          setDraft(
            (current) => current && { ...current, levels: { ...current.levels, [action]: next } },
          );
      })
      .catch(() => undefined);
  };

  const save = () => {
    if (!built.ok) {
      setFormError(built.message);
      return;
    }
    setFormError("");
    void write("autonomy", () =>
      client.request<AutonomyPolicy>("autonomy.set", {
        accountId: account.id,
        policy: built.policy,
        // The Host requires this confirmation for any autonomous level in the saved policy.
        ...(hasAutonomousLevel(draft.levels) ? { confirm: "ENABLE_AUTONOMY" } : {}),
      }),
    )
      .then((result) => {
        if (result === undefined) return;
        setPolicy(result);
        setDraft(draftFrom(result));
        onChanged();
      })
      .catch(() => undefined);
  };

  return (
    <section
      {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
      aria-label={t("Autonomy")}
    >
      <Text as="p" tone="muted" leading="snug" className="social-card-description">
        {t("Platform limits, opt-outs, working hours and the global AI stop still apply.")}
      </Text>
      <div className="social-autonomy-row social-autonomy-header" aria-hidden>
        <Text as="span" size="caption" tone="muted">
          {t("Action")}
        </Text>
        <Text as="span" size="caption" tone="muted">
          {t("Autonomy")}
        </Text>
        <Text as="span" size="caption" tone="muted">
          {t("Per day")}
        </Text>
      </div>
      {AUTONOMY_ACTIONS.map((action) => (
        <div key={action} className="social-autonomy-row">
          <Text as="span" size="secondary" leading="inherit">
            {autonomyLabel(action)}
          </Text>
          <Select
            hideLabel
            label={autonomyLabel(action)}
            value={draft.levels[action]}
            disabled={disabled || is("autonomy")}
            options={AUTONOMY_LEVELS.map((level) => ({ value: level, label: levelText(level) }))}
            onValueChange={(next) => askLevel(action, next as AutonomyLevel)}
          />
          <NumberField
            label={`${autonomyLabel(action)} · ${t("Per day")}`}
            hideLabel
            min={0}
            max={1000000}
            step={1}
            value={draft.limits[action]}
            placeholder={String(DEFAULT_AUTONOMY.limits[action] ?? "")}
            disabled={disabled || is("autonomy")}
            onChange={(event) =>
              setDraft({
                ...draft,
                limits: { ...draft.limits, [action]: event.currentTarget.value },
              })
            }
          />
        </div>
      ))}
      <Text as="p" tone="muted" leading="snug" className="social-muted">
        {t("Leave a daily limit blank to use the default.")}
      </Text>
      <Switch
        label={t("Act only during working hours")}
        checked={draft.hours.enabled}
        disabled={disabled || is("autonomy")}
        onCheckedChange={(enabled) => setDraft({ ...draft, hours: { ...draft.hours, enabled } })}
      />
      {draft.hours.enabled ? (
        <div className="social-working-hours">
          <TextField
            label={t("Time zone")}
            value={draft.hours.timeZone}
            disabled={disabled || is("autonomy")}
            onChange={(event) =>
              setDraft({ ...draft, hours: { ...draft.hours, timeZone: event.currentTarget.value } })
            }
          />
          <TimePicker
            label={t("Start")}
            value={draft.hours.start}
            disabled={disabled || is("autonomy")}
            onChange={(value) => setDraft({ ...draft, hours: { ...draft.hours, start: value } })}
          />
          <TimePicker
            label={t("End")}
            value={draft.hours.end}
            disabled={disabled || is("autonomy")}
            onChange={(value) => setDraft({ ...draft, hours: { ...draft.hours, end: value } })}
          />
          <FieldGroup legend={t("Days")} layout="row">
            {weekdayLabels(getLocale()).map(({ day, label }) => (
              <Checkbox
                disabled={disabled || is("autonomy")}
                checked={draft.hours.days.includes(day)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    hours: {
                      ...draft.hours,
                      days: event.target.checked
                        ? [...draft.hours.days, day]
                        : draft.hours.days.filter((item) => item !== day),
                    },
                  })
                }
                label={label}
                key={day}
                size="secondary"
                className="social-check"
              />
            ))}
          </FieldGroup>
        </div>
      ) : null}
      <div className="social-field-row">
        <DisabledReason
          variant="primary"
          size="sm"
          loading={is("autonomy")}
          onClick={save}
          {...gateProps(saveGate)}
        >
          {t("Save autonomy")}
        </DisabledReason>
      </div>
      {formError ? <InlineError>{formError}</InlineError> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirmation.dialog}
    </section>
  );
}
