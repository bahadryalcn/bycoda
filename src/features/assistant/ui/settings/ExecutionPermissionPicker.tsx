import { t } from "../../../../shared/i18n";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../../../sessions/public/session";
import { RUNTIME_MODE_ICONS } from "../../../sessions/public/runtimeModeOptions";
import { ProfileRow, useProfileRows } from "./SettingsProfileRow";
import styles from "./work.module.css";

/** The composer's access modes as icon segments; the selected mode's name and one-line description sit below. */
export function ExecutionPermissionPicker({
  value,
  onChange,
}: {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
}) {
  const segmented = (
    <SegmentedControl
      label={t("Execution permissions")}
      value={value}
      options={RUNTIME_MODES.map((mode) => {
        const Icon = RUNTIME_MODE_ICONS[mode];
        return {
          value: mode,
          label: t(RUNTIME_MODE_LABEL[mode]),
          icon: (
            <Icon
              className={`icon-sm ${mode === "full-access" ? "text-(--ui-tone-warning-fg)" : ""}`}
              strokeWidth={1.75}
            />
          ),
          iconOnly: true,
        };
      })}
      onValueChange={(next) => onChange(next as RuntimeMode)}
    />
  );
  if (useProfileRows())
    return (
      <ProfileRow
        label={t("Execution permissions")}
        description={`${t(RUNTIME_MODE_LABEL[value])}: ${t(RUNTIME_MODE_HINT[value])}`}
      >
        {() => segmented}
      </ProfileRow>
    );
  return (
    <div className={styles.permission}>
      <p className={styles.label}>{t("Execution permissions")}</p>
      {segmented}
      <p className={styles.permissionText}>
        <strong>{t(RUNTIME_MODE_LABEL[value])}</strong>
        <span>{t(RUNTIME_MODE_HINT[value])}</span>
      </p>
    </div>
  );
}
