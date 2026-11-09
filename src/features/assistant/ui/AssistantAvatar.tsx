import { useState } from "react";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TextField } from "../../../shared/ui/TextField";
import {
  ASSISTANT_AVATAR_PRESETS,
  assistantAvatarImageUrl,
  assistantAvatarPresetValue,
  assistantAvatarView,
} from "../model/assistantAvatar";
import styles from "./AssistantAvatar.module.css";

/**
 * The assistant's portrait, emoji or initials. Decorative: the name always sits next to it. A
 * portrait that fails to load leaves the box empty, so the CSS draws the name's first letter.
 */
export function AssistantAvatarMark({
  value,
  name,
  className,
}: {
  value: string | undefined;
  name: string;
  className?: string;
}) {
  const view = assistantAvatarView(value);
  const [failed, setFailed] = useState("");
  return (
    <span
      className={className}
      aria-hidden="true"
      data-initial={Array.from(name)[0]?.toLocaleUpperCase() ?? ""}
      data-avatar={view.kind}
    >
      {view.kind === "text" ? (
        view.text
      ) : failed === view.src ? null : (
        <img
          className={styles.image}
          src={view.src}
          alt=""
          draggable={false}
          onError={() => setFailed(view.src)}
        />
      )}
    </span>
  );
}

/** Portrait tiles plus a free emoji or initials field; clearing the field returns to the default portrait. */
export function AssistantAvatarPicker({
  value,
  hideLabel,
  onChange,
}: {
  value: string | undefined;
  hideLabel: boolean;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const view = assistantAvatarView(value);
  return (
    <div className={styles.picker}>
      <RadioGroup
        variant="tiles"
        label={t("Avatar")}
        className={styles.tiles}
        tileClassName={styles.tile}
        value={view.kind === "image" ? assistantAvatarPresetValue(view.id) : ""}
        onValueChange={(next) => onChange({ avatar: next })}
        options={ASSISTANT_AVATAR_PRESETS.map((preset) => ({
          value: assistantAvatarPresetValue(preset.id),
          ariaLabel: t(preset.label),
          tooltip: t(preset.label),
          content: (
            <img
              className={styles.tileImage}
              src={assistantAvatarImageUrl(preset.id)}
              alt=""
              draggable={false}
            />
          ),
        }))}
      />
      <TextField
        label={t("Emoji or initials")}
        hideLabel={hideLabel}
        value={view.kind === "text" ? view.text : ""}
        maxLength={200}
        placeholder={t("Emoji or initials")}
        onChange={(event) => onChange({ avatar: event.currentTarget.value })}
      />
    </div>
  );
}
