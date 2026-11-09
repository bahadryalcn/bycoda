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
    // A narrow panel keeps the submodule's name readable: the badge drops to its icon.
    <span className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="sm"
        tone="warning"
        className="gap-1"
        aria-label={label}
        onClick={onOpen}
        tooltip={t("Open the pointer change in {p0}", { p0: parent })}
      >
        <GitCommitVertical aria-hidden className="icon-xs" />
        <span aria-hidden className="hidden @min-[26rem]/changes:inline">
          {label}
        </span>
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
