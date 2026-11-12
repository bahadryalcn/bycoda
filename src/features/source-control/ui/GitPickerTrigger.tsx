import { Skeleton } from "../../../shared/ui/Skeleton";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { useContext } from "react";
import { NativePopupHost } from "../../../shared/ui/NativePopupHost";
import type { ComponentPropsWithoutRef } from "react";
import { ChevronDown, FolderTree, GitBranch } from "../../../shared/ui/icons";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";

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
      className="flex min-w-0 max-w-64 items-center gap-1.5"
    >
      <Icon className="icon-sm shrink-0" />
      <span className="relative flex min-w-0 flex-1">
        {loading ? (
          <>
            {/* Reserve the same line box while the current branch loads. */}
            <span className="invisible">{t("main")}</span>
            <Skeleton label={t("Loading…")} lines={1} className="absolute inset-0" />
          </>
        ) : (
          <MiddleTruncate mode="text">{label}</MiddleTruncate>
        )}
      </span>
      {worktree && (
        <Badge size="xs" appearance="subtle" className="shrink-0">
          {t("Worktree")}
        </Badge>
      )}
      <ChevronDown className="icon-xs shrink-0" tone="muted" />
    </Button>
  );
}
