import { errorText } from "../../lib/errors";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useT } from "../../i18n";
import { Button } from "../Button";
import { ErrorDetails } from "../ErrorDetails";
import { Undo2 } from "../icons";
import { Popover } from "../Popover";
import { StatusDot } from "../StatusDot";
import { surfaceAttributes } from "../Surface";
import { Text } from "../Text";
import { usePendingSource, type PendingChange } from "./pendingChanges";
import { SettingsFeedback } from "./SettingsRows";
import styles from "./SettingsSaveBar.module.css";

type SaveFailure = { detail: string } | null;

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
  /**
   * Resolves true only after the save was durably acknowledged; see `PendingSource.save`. A
   * rejection is caught by the bar: the draft, Save and its focus stay, and a failure notice with
   * Retry appears. Explain a refusal the editor understands (validation, conflict) through
   * `children` and resolve false instead of throwing.
   */
  onSave: () => boolean | Promise<boolean>;
  /** Controls next to the count, such as what the changes apply to. */
  leading?: ReactNode;
  /** Controls before Discard, such as the scope the editor saves to. */
  trailing?: ReactNode;
  /** Errors and conflict notes shown above the row. */
  children?: ReactNode;
};

async function saveSettings(
  onSave: SettingsSaveBarProps["onSave"],
  running: RefObject<boolean>,
  setBusy: (busy: boolean) => void,
  setFailure: (failure: SaveFailure) => void,
  notes: RefObject<HTMLDivElement | null>,
  saveButton: RefObject<HTMLButtonElement | null>,
): Promise<boolean> {
  // Duplicate-operation guard: taken before the first await.
  if (running.current) return false;
  running.current = true;
  setBusy(true);
  try {
    const acknowledged = (await onSave()) === true;
    // A refusal the editor explains itself leaves no stale failure.
    setFailure(null);
    // Retry unmounts once the attempt settles. Return focus to Save.
    if (notes.current?.contains(document.activeElement)) saveButton.current?.focus();
    return acknowledged;
  } catch (error) {
    // Keep the draft, registration and focus while showing the failure.
    setFailure({ detail: errorText(error) });
    return false;
  } finally {
    running.current = false;
    setBusy(false);
  }
}

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
  const saveButton = useRef<HTMLButtonElement>(null);
  const notes = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<SaveFailure>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const working = pending || busy;
  const dirty = changes.length > 0;
  // Every way to save (button, Retry, leave prompt) runs here, so a rejection is never unhandled.
  const save = () => saveSettings(onSave, running, setBusy, setFailure, notes, saveButton);
  const discard = () => {
    setFailure(null);
    onDiscard();
  };
  usePendingSource(
    dirty
      ? {
          id,
          title,
          changes,
          pending: working,
          canSave: canSave && !working,
          save,
          discard,
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
      {children || (failure && dirty) ? (
        <div ref={notes} className={styles.notes}>
          {children}
          {failure && dirty ? (
            <SettingsFeedback
              state="error"
              immediate
              action={{ label: t("Retry"), onClick: () => void save(), pending: busy }}
              extra={
                failure.detail ? (
                  <ErrorDetails title={t("Could not save changes")} detail={failure.detail} />
                ) : undefined
              }
            >
              {t("Could not save changes")}
            </SettingsFeedback>
          ) : null}
        </div>
      ) : null}
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
          disabled={working || !(discardEnabled ?? dirty)}
          onClick={discard}
        >
          {discardLabel ?? t("Discard")}
        </Button>
        <Button
          ref={saveButton}
          size="sm"
          variant="primary"
          loading={working}
          loadingLabel={t("Saving…")}
          success={saved && !dirty}
          successLabel={successLabel ?? t("Saved")}
          disabled={!dirty || !canSave}
          onClick={() => void save()}
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
                          disabled={working}
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
