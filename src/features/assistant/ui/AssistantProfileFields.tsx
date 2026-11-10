import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ProfileSegmented, ProfileSelect } from "./settings/ProfileControls";
import { ProfileRow, ProfileSwitch, useProfileRows } from "./settings/SettingsProfileRow";
import { AssistantWorkFields } from "./settings/AssistantWorkFields";
import { AssistantWorkModeField } from "./settings/AssistantWorkModeField";
import { AssistantScheduleFields } from "./settings/AssistantScheduleFields";
import { AssistantCostFields } from "./settings/AssistantCostFields";
import { AssistantAvatarPicker } from "./AssistantAvatar";
import styles from "./AssistantView.module.css";
import roleStyles from "./AssistantProfileFields.module.css";

export type ProfileSection =
  | "identity"
  | "language"
  | "personality"
  | "behavior"
  | "workmode"
  | "jobs"
  | "budget"
  | "permissions"
  | "presence"
  | "notifications"
  | "cost";

/** Renders one settings or setup section. Callers own the grid and headings. */
export function AssistantProfileFields({
  section,
  value,
  onChange,
  observationTasksAvailable = false,
  workModeUnchosen = false,
}: {
  section: ProfileSection;
  value: AssistantProfilePatch;
  observationTasksAvailable?: boolean;
  /** Work mode only: show no selection instead of "Custom" (first setup, nothing chosen yet). */
  workModeUnchosen?: boolean;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const rows = useProfileRows();
  if (section === "identity")
    return (
      <>
        <ProfileRow label={t("Assistant name")}>
          {(hideLabel) => (
            <TextField
              label={t("Assistant name")}
              hideLabel={hideLabel}
              fieldClassName={hideLabel ? roleStyles.grow : undefined}
              value={value.name ?? ""}
              maxLength={80}
              autoComplete="off"
              required
              onChange={(event) => onChange({ name: event.currentTarget.value })}
            />
          )}
        </ProfileRow>
        <ProfileRow label={t("How should I address you?")}>
          {(hideLabel) => (
            <TextField
              label={t("How should I address you?")}
              hideLabel={hideLabel}
              fieldClassName={hideLabel ? roleStyles.grow : undefined}
              value={value.addressAs ?? ""}
              maxLength={100}
              onChange={(event) => onChange({ addressAs: event.currentTarget.value })}
            />
          )}
        </ProfileRow>
        <ProfileSegmented
          label={t("How often to use your name")}
          value={value.addressFrequency ?? "sometimes"}
          options={[
            ["always", "Always"],
            ["sometimes", "Sometimes"],
            ["never", "Never"],
          ]}
          onValueChange={(next) =>
            onChange({ addressFrequency: next as AssistantProfilePatch["addressFrequency"] })
          }
        />
        <ProfileRow
          label={t("Avatar")}
          description={t("Pick a portrait, or type an emoji or initials.")}
          stacked
        >
          {(hideLabel) => (
            <AssistantAvatarPicker value={value.avatar} hideLabel={hideLabel} onChange={onChange} />
          )}
        </ProfileRow>
        <ShowTitle value={value} onChange={onChange} />
      </>
    );
  if (section === "language")
    return (
      <ProfileLanguage
        value={String(value.language ?? "auto")}
        onValueChange={(language) => onChange({ language })}
      />
    );
  if (section === "personality")
    return (
      <>
        <ProfileSelect
          label="Tone"
          value={String(value.tone ?? "friendly")}
          options={[
            ["friendly", "Friendly"],
            ["neutral", "Neutral"],
            ["formal", "Formal"],
            ["casual", "Casual"],
            ["blunt", "Blunt"],
          ]}
          onValueChange={(tone) => onChange({ tone: tone as AssistantProfilePatch["tone"] })}
        />
        <ProfileSwitch
          label={t("Allow profanity")}
          description={t("Style only. Never aimed at anyone.")}
          hintClassName={styles.muted}
          checked={value.allowProfanity === true}
          onCheckedChange={(allowProfanity) => onChange({ allowProfanity })}
        />
        <ProfileRow label={t("Persona")} stacked>
          {(hideLabel) => (
            <div className={roleStyles.wide}>
              <TextareaField
                label={t("Persona")}
                hideLabel={hideLabel}
                value={value.persona ?? ""}
                maxLength={2000}
                minRows={3}
                placeholder={t("e.g. Talk like a laid-back teammate, short answers")}
                onChange={(event) => onChange({ persona: event.currentTarget.value })}
              />
            </div>
          )}
        </ProfileRow>
      </>
    );
  if (section === "behavior")
    return (
      <>
        <ProfileSwitch
          label={t("Speak job updates while voice is connected")}
          checked={value.voiceNarration === true}
          onCheckedChange={(voiceNarration) => onChange({ voiceNarration })}
        />
        <ProfileSelect
          label={t("Start a conversation")}
          hint={rows ? "The microphone opens only when you choose to talk." : undefined}
          value={String(value.proactiveSpeech ?? "never")}
          options={[
            ["never", "Never"],
            ["return", "Only when I return"],
            ["important", "Also for important events"],
          ]}
          onValueChange={(next) =>
            onChange({ proactiveSpeech: next as AssistantProfilePatch["proactiveSpeech"] })
          }
        />
        {!rows && (
          <p className={`${styles.muted} ${roleStyles.wide}`}>
            {t("The microphone opens only when you choose to talk.")}
          </p>
        )}
      </>
    );
  if (section === "workmode")
    return <AssistantWorkModeField value={value} onChange={onChange} unchosen={workModeUnchosen} />;
  if (section === "jobs" || section === "budget" || section === "permissions")
    return <AssistantWorkFields value={value} onChange={onChange} part={section} />;
  if (section === "presence" || section === "notifications")
    return (
      <AssistantScheduleFields
        value={value}
        onChange={onChange}
        observationTasksAvailable={observationTasksAvailable}
        part={section === "notifications" ? "notifications" : rows ? "presence" : "all"}
      />
    );
  return <AssistantCostFields value={value} onChange={onChange} />;
}

/** "Show title" with a preview of how the name reads once the name is set. */
function ShowTitle({
  value,
  onChange,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const name = value.name?.trim();
  const preview = name ? (
    <InfoPopover label={t("Preview")}>
      {" "}
      <p className={styles.muted}>
        {value.showTitle ? t("Assistant {p0}", { p0: name }) : name} ·{" "}
        {t("Room · {p0}", { p0: name })} · {t("{p0} wrote", { p0: name })}
      </p>
    </InfoPopover>
  ) : undefined;
  const rows = useProfileRows();
  if (rows)
    return (
      <ProfileSwitch
        label={t("Show title")}
        info={preview}
        checked={value.showTitle ?? true}
        onCheckedChange={(showTitle) => onChange({ showTitle })}
      />
    );
  return (
    <div className={roleStyles.inlineControls}>
      <Switch
        label={t("Show title")}
        checked={value.showTitle ?? true}
        onCheckedChange={(showTitle) => onChange({ showTitle })}
      />
      {preview}
    </div>
  );
}

const LANGUAGES = [
  ["auto", "Auto"],
  ["tr-TR", "Türkçe"],
  ["en-US", "English"],
  ["de-DE", "Deutsch"],
  ["fr-FR", "Français"],
  ["es-ES", "Español"],
  ["pt-PT", "Português"],
  ["zh-CN", "简体中文"],
  ["ja-JP", "日本語"],
] as const;

/** Language select: a row with a one-line description in settings, the select plus info popover in setup. */
function ProfileLanguage({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (language: string) => void;
}) {
  const help = t("Auto follows the language you speak. A selected language overrides it.");
  if (useProfileRows())
    return (
      <ProfileRow label={t("Language")} description={help}>
        {() => (
          <Select
            hideLabel
            label={t("Language")}
            value={value}
            options={LANGUAGES.map(([id, label]) => ({ value: id, label }))}
            onValueChange={onValueChange}
          />
        )}
      </ProfileRow>
    );
  return (
    <div className={roleStyles.inlineField}>
      <ProfileSelect
        label="Language"
        value={value}
        options={LANGUAGES}
        onValueChange={onValueChange}
      />
      <InfoPopover label={t("About language")}>
        <p className={styles.muted}>{help}</p>
      </InfoPopover>
    </div>
  );
}
