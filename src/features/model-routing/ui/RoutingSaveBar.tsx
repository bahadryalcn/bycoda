import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import styles from "./RoutingSaveBar.module.css";

/**
 * One save bar for the Models routing tabs: sticks to the bottom of the settings scroller so
 * Save stays reachable on long lists, and states plainly whether anything is unsaved.
 */
export function RoutingSaveBar({
  dirty,
  pending,
  saved,
  canSave = true,
  discardLabel,
  discardEnabled,
  successLabel,
  onDiscard,
  onSave,
  children,
}: {
  dirty: boolean;
  pending: boolean;
  saved: boolean;
  /** False while the draft is invalid or conflicted. */
  canSave?: boolean;
  discardLabel?: string;
  /** Defaults to `dirty`; a conflict may enable Reload without local edits. */
  discardEnabled?: boolean;
  successLabel?: string;
  onDiscard: () => void;
  onSave: () => void;
  /** Errors and conflict notes shown above the buttons. */
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      {...surfaceAttributes(
        { variant: "base", frame: "settings", edge: "block-start" },
        styles.bar,
      )}
    >
      {children ? <div className={styles.notes}>{children}</div> : null}
      <div className={styles.row}>
        <div className={styles.status}>
          {dirty ? <StatusDot tone="warning" /> : null}
          <Text size="secondary" tone={dirty ? "primary" : "muted"}>
            {dirty ? t("Unsaved changes") : t("No unsaved changes")}
          </Text>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || !(discardEnabled ?? dirty)}
          onClick={onDiscard}
        >
          {discardLabel ?? t("Discard")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={pending}
          loadingLabel={t("Saving…")}
          success={saved && !dirty}
          successLabel={successLabel ?? t("Saved")}
          disabled={!dirty || !canSave}
          onClick={onSave}
        >
          {t("Save")}
        </Button>
      </div>
    </div>
  );
}
