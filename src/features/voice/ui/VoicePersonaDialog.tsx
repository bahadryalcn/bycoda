import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Combobox } from "../../../shared/ui/Combobox";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t, useLocale } from "../../../shared/i18n";
import {
  DEFAULT_VOICE_PERSONA,
  PERSONA_ADDRESSES,
  PERSONA_DUTIES,
  PERSONA_LIMITS,
  PERSONA_NAMES,
  PERSONA_TONES,
  loadVoicePersona,
  saveVoicePersona,
  type VoicePersona,
} from "../model/voicePersona";
import styles from "./VoicePersonaDialog.module.css";

const choices = (table: Record<string, { label: string }>) =>
  Object.entries(table).map(([value, { label }]) => ({
    value,
    label: t(label),
  }));

/** First-run setup ("welcome") and later editing from Settings ("edit") share one form.
 * Closing without a choice keeps the persona unset, so first run asks again. */
export function VoicePersonaDialog({
  purpose,
  onClose,
  styleOnly = false,
}: {
  purpose: "welcome" | "edit";
  onClose: () => void;
  styleOnly?: boolean;
}) {
  useLocale();
  const [draft, setDraft] = useState<VoicePersona>(loadVoicePersona);
  const change = (patch: Partial<VoicePersona>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const finish = (value: VoicePersona) => {
    const previous = loadVoicePersona();
    saveVoicePersona(
      styleOnly
        ? { ...value, name: previous.name, userName: previous.userName, rules: previous.rules }
        : value,
    );
    onClose();
  };
  const toggleDuty = (duty: string, on: boolean) =>
    change({
      duties: on ? [...draft.duties, duty] : draft.duties.filter((value) => value !== duty),
    });
  const welcome = purpose === "welcome";
  return (
    <Modal
      title={
        styleOnly
          ? t("Voice style")
          : welcome
            ? t("Make the voice companion yours")
            : t("Companion identity")
      }
      description={
        welcome
          ? t("Pick a few options or write your own. You can change them later in Settings.")
          : t("Choose how your voice companion introduces itself and talks to you.")
      }
      size="md"
      onClose={onClose}
      footer={
        <ModalActions
          start={
            // Skipping and resetting both keep the default companion and never ask again.
            <Button
              variant="ghost"
              onClick={() => finish({ ...DEFAULT_VOICE_PERSONA, status: "skipped" })}
            >
              {welcome ? t("Skip customization") : t("Reset to default")}
            </Button>
          }
        >
          {!welcome ? (
            <Button variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => finish({ ...draft, status: "configured" })}>
            {welcome ? t("Save and start") : t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <div className={styles.form}>
        {!styleOnly ? (
          <div className={styles.pair}>
            <Combobox
              label={t("Companion name")}
              allowCustomValue
              value={draft.name}
              placeholder="bycoda"
              maxLength={PERSONA_LIMITS.name}
              options={PERSONA_NAMES.map((name) => ({
                value: name,
                label: name,
              }))}
              onValueChange={(name) => change({ name: name.slice(0, PERSONA_LIMITS.name) })}
            />
            <TextField
              label={t("Your name")}
              value={draft.userName}
              placeholder={t("Optional")}
              maxLength={PERSONA_LIMITS.userName}
              autoComplete="given-name"
              onChange={(event) => change({ userName: event.target.value })}
            />
          </div>
        ) : null}
        <div className={styles.pair}>
          <Combobox
            label={t("How it addresses you")}
            allowCustomValue
            value={draft.address}
            placeholder={t("Choose or type…")}
            maxLength={PERSONA_LIMITS.address}
            options={choices(PERSONA_ADDRESSES)}
            onValueChange={(address) =>
              change({ address: address.slice(0, PERSONA_LIMITS.address) })
            }
          />
          <Combobox
            label={t("Tone")}
            allowCustomValue
            value={draft.tone}
            placeholder={t("Choose or type…")}
            maxLength={PERSONA_LIMITS.tone}
            options={choices(PERSONA_TONES)}
            onValueChange={(tone) => change({ tone: tone.slice(0, PERSONA_LIMITS.tone) })}
          />
        </div>
        <fieldset className={styles.duties}>
          <legend className={styles.legend}>{t("Tasks")}</legend>
          <div className={styles.choices}>
            {Object.entries(PERSONA_DUTIES).map(([duty, { label }]) => (
              <Checkbox
                key={duty}
                className={styles.choice}
                label={t(label)}
                checked={draft.duties.includes(duty)}
                onChange={(event) => toggleDuty(duty, event.target.checked)}
              />
            ))}
          </div>
          <TextField
            label={t("Other tasks")}
            hideLabel
            value={draft.customDuties}
            placeholder={t("Other tasks, in your own words")}
            maxLength={PERSONA_LIMITS.customDuties}
            onChange={(event) => change({ customDuties: event.target.value })}
          />
        </fieldset>
        {!styleOnly ? (
          <TextareaField
            label={t("Ground rules")}
            description={t(
              "For example: always answer in English, keep replies under two sentences.",
            )}
            value={draft.rules}
            minRows={3}
            maxRows={8}
            autosize
            maxLength={PERSONA_LIMITS.rules}
            onChange={(event) => change({ rules: event.target.value })}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/** One line for Settings: the chosen name and tone, or the default. */
export function voicePersonaSummary(persona: VoicePersona): string {
  if (persona.status !== "configured") return t("Default companion");
  const name = persona.name.trim() || "bycoda";
  const tone = persona.tone.trim();
  const toneLabel = Object.prototype.hasOwnProperty.call(PERSONA_TONES, tone)
    ? t(PERSONA_TONES[tone as keyof typeof PERSONA_TONES].label)
    : tone;
  return toneLabel ? `${name} · ${toneLabel}` : name;
}
