import { Skeleton } from "../../../shared/ui/Skeleton";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { useContext } from "react";
import { NativePopupHost } from "../../../shared/ui/NativePopupHost";
import type { ComponentPropsWithoutRef } from "react";
import { ChevronDown, FolderTree, GitBranch } from "../../../shared/ui/icons";

type Props = Omit<ComponentPropsWithoutRef<"button">, "children" | "className"> & {
  label: string;
  loading?: boolean;
  worktree?: boolean;
  dimWhenDisabled?: boolean;
};

/** Keep working-copy and branch modes visually identical in the composer. */
export function GitPickerTrigger({
  label,
  loading = false,
  worktree = false,
  dimWhenDisabled: _dimWhenDisabled = true,
  ...props
}: Props) {
  useLocale();
  const host = useContext(NativePopupHost);
  if (host) return null;
  const Icon = worktree ? FolderTree : GitBranch;
  return (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      type="button"
      {...props}
      className={"-ml-1.5 flex min-w-0 max-w-64 items-center gap-1.5"}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="relative min-w-0 flex-1 truncate">
        {loading ? (
          <>
            {/* Reserve the same line box while the current branch loads. */}
            <span className="invisible">{t("main")}</span>
            <Skeleton label={t("Loading…")} lines={1} className="absolute inset-0" />
          </>
        ) : (
          label
        )}
      </span>
      {worktree && (
        <span className="shrink-0 rounded bg-(--ui-surface-muted) px-1 text-(length:--ui-font-caption) leading-4 text-(--ui-text-secondary)">
          {t("Worktree")}
        </span>
      )}
      <ChevronDown className="size-3 shrink-0 text-[var(--ui-text-muted)]" />
    </Button>
  );
}
