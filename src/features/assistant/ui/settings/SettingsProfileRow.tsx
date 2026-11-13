import { createContext, useContext, type ReactNode } from "react";
import { Switch } from "../../../../shared/ui/Switch";
import { Text } from "../../../../shared/ui/Text";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { t } from "../../../../shared/i18n";
import { Row } from "../../../settings/public/settingsControls";
import roleStyles from "../AssistantProfileFields.module.css";

/**
 * The profile fields render in two layouts: the setup wizard's plain form (default) and the
 * settings dialog's rows (title and one-line description left, control right). The dialog turns
 * rows on through this provider so one field implementation serves both.
 */
const ProfileRowsContext = createContext(false);
export const ProfileRowsProvider = ProfileRowsContext.Provider;
export const useProfileRows = () => useContext(ProfileRowsContext);

/** Rows layout wraps the control in a settings Row; the form layout returns the control alone. */
export function ProfileRow({
  label,
  description,
  info,
  stacked,
  children,
}: {
  label: string;
  description?: string;
  info?: ReactNode;
  stacked?: boolean;
  /** Receives `true` when the row owns the visible label, so the control keeps it as its accessible name only. */
  children: (hideLabel: boolean) => ReactNode;
}) {
  const rows = useProfileRows();
  if (!rows) return <>{children(false)}</>;
  return (
    <Row
      label={label}
      description={info ? description : undefined}
      info={
        info ??
        (description ? (
          <InfoPopover label={`${label}: ${t("Help")}`}>{description}</InfoPopover>
        ) : undefined)
      }
      stacked={stacked}
    >
      {children(true)}
    </Row>
  );
}

/** An immediately drafted switch with an optional one-line description. */
export function ProfileSwitch({
  label,
  description,
  hintClassName,
  hintSize = "caption",
  info,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  hintClassName?: string;
  /** Size of the one-line description: `micro` for a dense note, `caption` by default. */
  hintSize?: "micro" | "caption";
  info?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  if (useProfileRows())
    return (
      <Row
        label={label}
        description={info ? description : undefined}
        info={
          info ??
          (description ? (
            <InfoPopover label={`${label}: ${t("Help")}`}>{description}</InfoPopover>
          ) : undefined)
        }
      >
        <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
      </Row>
    );
  return (
    <div className={roleStyles.switchRow}>
      <Switch label={label} checked={checked} onCheckedChange={onCheckedChange} />
      {description && (
        <Text as="p" size={hintSize} tone="secondary" leading="normal" className={hintClassName}>
          {description}
        </Text>
      )}
    </div>
  );
}
