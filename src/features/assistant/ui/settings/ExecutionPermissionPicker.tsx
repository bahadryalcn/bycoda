import { t } from "../../../../shared/i18n";
import { runtimeModeHint, runtimeModeLabel } from "../../model/runtimeModeText";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { RUNTIME_MODES, type RuntimeMode } from "../../../sessions/public/session";
import { RUNTIME_MODE_ICONS } from "../../../sessions/public/runtimeModeOptions";
import { ProfileRow } from "./SettingsProfileRow";

/** The composer's access modes as icon segments; the selected mode's name and hint sit behind the row's info. */
export function ExecutionPermissionPicker({
  value,
  onChange,
}: {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
}) {
  return (
    <ProfileRow
      label={t("Execution permissions")}
      description={`${runtimeModeLabel(value)}: ${runtimeModeHint(value)}`}
    >
      {() => (
        <SegmentedControl
          label={t("Execution permissions")}
          value={value}
          options={RUNTIME_MODES.map((mode) => {
            const Icon = RUNTIME_MODE_ICONS[mode];
            return {
              value: mode,
              label: runtimeModeLabel(mode),
              icon: (
                <Icon
                  className="icon-sm"
                  tone={mode === "full-access" ? "warning" : undefined}
                  strokeWidth={1.75}
                />
              ),
              iconOnly: true,
            };
          })}
          onValueChange={(next) => onChange(next as RuntimeMode)}
        />
      )}
    </ProfileRow>
  );
}
