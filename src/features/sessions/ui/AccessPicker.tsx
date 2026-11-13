import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { RUNTIME_MODE_HINT, RUNTIME_MODE_LABEL, type RuntimeMode } from "../model/session";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { runtimeModeOptions } from "./runtimeModeOptions";

type Props = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  onClose?: () => void;
  busy?: boolean;
  /** Modes the harness cannot honour, with why. They show, but cannot be picked. */
  unavailable?: Partial<Record<RuntimeMode, string>>;
};

const MENU_WIDTH = 288;

export function AccessPicker({ value, onChange, onClose, busy = false, unavailable }: Props) {
  const t = useT();
  return (
    <div data-usage-guide="access-mode">
      <SearchableSelect
        label={t("Access")}
        hideLabel
        variant="pill"
        searchable={false}
        side="top"
        menuMinWidth={MENU_WIDTH}
        menuAttributes={{ "data-access-picker": "" }}
        value={value}
        options={runtimeModeOptions(unavailable).map((option) => ({
          value: option.value,
          label: String(option.title),
          icon: option.icon,
          disabled: option.disabled,
          description:
            option.disabled && option.disabledReason
              ? t("Unavailable: {p0}", { p0: option.disabledReason })
              : String(option.description ?? ""),
        }))}
        onChange={(mode) => onChange(mode as RuntimeMode)}
        onClose={(restoreFocus) => {
          if (restoreFocus) onClose?.();
        }}
        tooltip={`${RUNTIME_MODE_HINT[value]}${busy ? ` ${t("Access changes apply to the next turn. Stop and resend to apply them now.")}` : ""}`}
        triggerProps={{
          "data-access-picker-trigger": "",
          "aria-label": RUNTIME_MODE_LABEL[value],
          onMouseDown: (event) => event.preventDefault(),
        }}
        footer={
          busy ? (
            <Text as="p" size="micro" weight="regular">
              {t("Access changes apply to the next turn. Stop and resend to apply them now.")}
            </Text>
          ) : undefined
        }
      />
    </div>
  );
}
