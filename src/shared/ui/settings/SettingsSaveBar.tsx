import { useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import { Button } from "../Button";
import { Undo2 } from "../icons";
import { Popover } from "../Popover";
import { StatusDot } from "../StatusDot";
import { surfaceAttributes } from "../Surface";
import { Text } from "../Text";
import { usePendingSource, type PendingChange } from "./pendingChanges";
import styles from "./SettingsSaveBar.module.css";

export type SettingsSaveBarProps = {
  /** Stable id of this editor; the settings shell asks before leaving while it has changes. */
  id: string;
  /** Section name used by the leave prompt, e.g. "Background work". */
  title: string;
  /** Every unsaved change, in any scope of this editor. Empty means clean. */
  changes: readonly PendingChange[];
  pending: boolean;
  saved: boolean;
  /** False while the draft is invalid or conflicted. */
  canSave?: boolean;
  discardLabel?: string;
  /** Defaults to having changes; a conflict may enable Reload without local edits. */
  discardEnabled?: boolean;
  saveLabel?: string;
  successLabel?: string;
  onDiscard: () => void;
  onSave: () => unknown;
  /** Controls next to the count, such as what the changes apply to. */
  leading?: ReactNode;
  /** Controls before Discard, such as the scope the editor saves to. */
  trailing?: ReactNode;
  /** Errors and conflict notes shown above the row. */
  children?: ReactNode;
};

/**
 * The one save bar for explicit-save settings. It sticks to the bottom of the settings
 * scroller, counts changes across every scope of the editor and lists them (grouped by scope,
 * each revertible when the editor allows) in a popover, so switching provider, account or
 * project never hides an edit. It registers the draft so leaving Settings asks first.
 * @group actions
 * @use Every settings editor with an explicit Save.
 * @avoid Settings that save on change: no bar. One field with its own commit: InlineTextAction.
 */
export function SettingsSaveBar({
  id,
  title,
  changes,
  pending,
  saved,
  canSave = true,
  discardLabel,
  discardEnabled,
  saveLabel,
  successLabel,
  onDiscard,
  onSave,
  leading,
  trailing,
  children,
}: SettingsSaveBarProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const dirty = changes.length > 0;
  usePendingSource(
    dirty
      ? {
          id,
          title,
          changes,
          pending,
          canSave: canSave && !pending,
          save: onSave,
          discard: onDiscard,
        }
      : null,
  );
  const scopes = [...new Set(changes.map((change) => change.scope ?? ""))];
  return (
    <div
      data-settings-save-bar={id}
      {...surfaceAttributes({ variant: "canvas", frame: "pane", edge: "block-start" }, styles.bar)}
      data-save-bar={id}
    >
      {children ? <div className={styles.notes}>{children}</div> : null}
      <div className={styles.row}>
        <div className={styles.status}>
          {dirty ? (
            <Button
              ref={anchor}
              size="sm"
              variant="ghost"
              startIcon={<StatusDot tone="warning" />}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              {changes.length === 1
                ? t("1 unsaved change")
                : t("{p0} unsaved changes", { p0: changes.length })}
            </Button>
          ) : null}
          {leading}
        </div>
        {trailing}
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
          onClick={() => void onSave()}
        >
          {saveLabel ?? t("Save")}
        </Button>
      </div>
      {open && dirty ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          kind="dialog"
          width={360}
          aria-label={t("Unsaved changes")}
          onDismiss={() => setOpen(false)}
        >
          <div className={styles.list}>
            {scopes.map((scope) => (
              <section key={scope} className={styles.scope}>
                {scope ? (
                  <Text as="p" size="caption" tone="secondary" weight="medium">
                    {scope}
                  </Text>
                ) : null}
                {changes
                  .filter((change) => (change.scope ?? "") === scope)
                  .map((change) => (
                    <div key={change.id} className={styles.change}>
                      <div className={styles.changeText}>
                        <Text size="secondary" truncate>
                          {change.label}
                        </Text>
                        {change.detail ? (
                          <Text size="caption" tone="secondary" truncate>
                            {change.detail}
                          </Text>
                        ) : null}
                      </div>
                      {change.revert ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          label={t("Undo {p0}", { p0: change.label })}
                          disabled={pending}
                          onClick={change.revert}
                        >
                          <Undo2 className="icon-sm" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
