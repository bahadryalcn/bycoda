import { t, useLocale } from "../../../shared/i18n/git";
import { Button } from "../../../shared/ui/Button";
import { GitCommitVertical, Minus, Plus } from "../../../shared/ui/icons";
import type { GitChangedFile } from "../../../platform/tauri/fs";

/**
 * A submodule row's gitlink change in its parent repository: the parent's change
 * list leaves it out, so it is reviewed and staged here, once. The parent's count
 * and Commit still include it.
 */
export function SubmodulePointer({
  parent,
  file,
  onOpen,
  onAct,
}: {
  /** Display name of the parent repository that records this pointer. */
  parent: string;
  file: GitChangedFile;
  onOpen: () => void;
  onAct: (action: "stage" | "unstage") => unknown;
}) {
  useLocale();
  const stage = file.unstaged;
  const label = stage ? t("Pointer changed") : t("Pointer staged");
  return (
    // Icon only: the submodule's name stays readable at any panel width.
    <span className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        tone="warning"
        label={label}
        tooltip={t("Open the pointer change in {p0}", { p0: parent })}
        onClick={onOpen}
      >
        <GitCommitVertical aria-hidden className="icon-sm" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={
          stage
            ? t("Stage the pointer in {p0}", { p0: parent })
            : t("Unstage the pointer in {p0}", { p0: parent })
        }
        onClick={() => onAct(stage ? "stage" : "unstage")}
      >
        {stage ? <Plus className="icon-sm" /> : <Minus className="icon-sm" />}
      </Button>
    </span>
  );
}
