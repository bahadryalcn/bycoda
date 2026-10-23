import { Button } from "../../../shared/ui/Button";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { useGitPanelState, withGitOperation, setGitFeedback } from "../model/gitPanelState";
import {
  gitOperationAbort,
  gitOperationContinue,
  type GitOperation,
} from "../../../platform/tauri/fs";
import { operationLabel } from "../model/commitActions";
import { operationSummary } from "../model/conflictSection";

type Props = {
  cwd: string;
  operation: GitOperation;
  /** Unmerged files left; Continue waits for zero. The files are listed in the Merge Conflicts section. */
  conflictCount: number;
  /** Reload the panel; called after Continue or Abort, whether it worked or not. */
  onChanged: () => void;
};

const ACTION = "shrink-0";

/**
 * Shown while git is stopped in the middle of a merge, rebase, cherry-pick, or
 * revert: which one, how many conflicts are left, and Continue / Abort. The
 * panel owns the state (it rides on the index poll) and lists the files.
 */
export function GitOperationBanner({ cwd, operation, conflictCount, onChanged }: Props) {
  useLocale();
  const [busy] = useGitPanelState(cwd, "busy");
  const { confirm, dialog: confirmElement } = useConfirm();
  const label = operationLabel(operation);

  const run = async (work: () => Promise<unknown>) => {
    try {
      await withGitOperation(cwd, `Updating ${label.toLowerCase()}…`, work);
      setGitFeedback(cwd, {
        kind: "success",
        get title() {
          return t("{p0} operation complete", { p0: label });
        },
      });
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "error",
        get title() {
          return t("Couldn’t update {p0}", { p0: label.toLowerCase() });
        },
        detail: errorText(error),
      });
    } finally {
      onChanged();
    }
  };

  const abort = async () => {
    const confirmed = await confirm({
      title: t("Abort"),
      message: t("Abort the {p0}? Changes made while resolving it are discarded.", {
        p0: label.toLowerCase(),
      }),
      confirmLabel: t("Abort"),
    });
    if (confirmed) await run(() => gitOperationAbort(cwd));
  };

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-1 border-b border-stroke bg-[var(--ui-surface)] px-3 py-1.5 text-ui-caption text-[var(--color-content)]"
    >
      {confirmElement}
      <span className="min-w-0 flex-1 truncate">{operationSummary(label, conflictCount)}</span>
      <Button
        variant="secondary"
        motion="none"
        type="button"
        disabled={!!busy || conflictCount > 0}
        title={
          conflictCount > 0
            ? t("Resolve every conflict first")
            : t("Continue the {p0}", { p0: label.toLowerCase() })
        }
        onClick={() => void run(() => gitOperationContinue(cwd))}
        className={ACTION}
      >
        {t("Continue")}
      </Button>
      <Button
        variant="ghost"
        tone="danger"
        motion="none"
        type="button"
        disabled={!!busy}
        title={t("Abort the {p0}", { p0: label.toLowerCase() })}
        onClick={() => void abort()}
        className={ACTION}
      >
        {t("Abort")}
      </Button>
    </div>
  );
}
