import { t, useLocale } from "../../../shared/i18n";
import { PickerList } from "../../../shared/ui/picker";
import { RUNTIME_MODE_ICONS, runtimeModeOptions } from "../../sessions/ui/runtimeModeOptions";
import { type RuntimeMode } from "../../sessions/model/session";

export function QuickPermissionIcon({
  mode,
  className,
}: {
  mode: RuntimeMode;
  className?: string;
}) {
  useLocale();
  const Icon = RUNTIME_MODE_ICONS[mode];
  return (
    <Icon
      className={`${className ?? ""} ${mode === "full-access" ? "text-(--ui-tone-warning-fg)" : ""}`}
      strokeWidth={1.75}
    />
  );
}

export function QuickPermissions({
  value,
  onChange,
  onClose,
  unavailable,
  embedded = false,
}: {
  value: RuntimeMode;
  /** Modes the harness's transport cannot honour, with the reason to show. */
  unavailable?: Partial<Record<RuntimeMode, string>>;
  onChange: (mode: RuntimeMode) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  useLocale();
  return (
    <div
      className={`min-h-0 overflow-y-auto overscroll-none p-2 ${embedded ? "" : "border-t border-stroke"}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <PickerList
        label={t("Permissions")}
        loop
        autoFocus={!embedded}
        options={runtimeModeOptions(unavailable)}
        value={value}
        onChange={(mode: string) => {
          onChange(mode as RuntimeMode);
          if (!embedded) onClose();
        }}
      />
    </div>
  );
}
