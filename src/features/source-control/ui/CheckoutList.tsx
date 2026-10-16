import { type ReactNode } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t, useLocale } from "../../../shared/i18n/git";
import { Button } from "../../../shared/ui/Button";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Lock,
  MessageSquare,
  Trash2,
} from "../../../shared/ui/icons";
import { requestWorktreeManagement } from "../model/worktreeManagement";
import {
  checkoutRowLabels,
  checkoutSelectionScope,
  groupCheckouts,
  sessionCheckout,
} from "../model/checkoutSelection";
import type { Worktree } from "../model/worktrees";
import { pathKey } from "../../../shared/lib/paths";
import styles from "./CheckoutList.module.css";

/** Lightweight overview of every checkout, built only from already-loaded worktree data. */
export function CheckoutList({
  cwd,
  worktrees,
  onSelect,
  enabled = true,
}: {
  cwd: string;
  worktrees: readonly Worktree[];
  onSelect: (path: string) => void;
  enabled?: boolean;
}) {
  useLocale();
  const scope = checkoutSelectionScope(
    cwd,
    worktrees.map((tree) => tree.path),
  );
  const [idleOpen, setIdleOpen] = useRetainedState(`checkout-list:${scope}:idle`, false);
  const groups = groupCheckouts(worktrees, cwd);
  const current = sessionCheckout(
    cwd,
    worktrees.map((tree) => tree.path),
  );
  const row = (tree: Worktree) => {
    const isSession = !!current && pathKey(tree.path) === pathKey(current);
    const unpushed = tree.unpushed ?? 0;
    const sessions = tree.sessionIds.length;
    const { title, detail } = checkoutRowLabels(tree);
    return (
      <li key={tree.path} className={styles.item}>
        <Button
          variant="item"
          motion="none"
          className={`${styles.row} min-w-0 flex-1`}
          data-session={isSession || undefined}
          title={tree.path}
          onClick={() => onSelect(tree.path)}
        >
          <span className={styles.identity}>
            <span className={styles.branch}>{title}</span>
            {detail ? <span className={styles.folder}>{detail}</span> : null}
            {isSession ? (
              <span className={styles.tag} data-tone="accent">
                {t("This session")}
              </span>
            ) : null}
            {tree.isMain ? <span className={styles.tag}>{t("Main folder")}</span> : null}
          </span>
          <span className={styles.badges}>
            {tree.locked ? (
              <span role="img" title={t("Locked")} aria-label={t("Locked")}>
                <Lock className="size-3" />
              </span>
            ) : null}
            {tree.dirty ? (
              <span
                role="img"
                className={styles.dirty}
                title={t("Uncommitted changes")}
                aria-label={t("Uncommitted changes")}
              />
            ) : null}
            <Stat
              icon={<ArrowUp aria-hidden className="size-3" />}
              count={unpushed}
              label={t(unpushed === 1 ? "{p0} unpushed commit" : "{p0} unpushed commits", {
                p0: unpushed,
              })}
            />
            <Stat
              icon={<MessageSquare aria-hidden className="size-3" />}
              count={sessions}
              label={t(
                sessions === 1 ? "{p0} session in this checkout" : "{p0} sessions in this checkout",
                { p0: sessions },
              )}
            />
          </span>
        </Button>
        {!tree.isMain ? (
          <Button
            variant="ghost"
            iconOnly
            className={styles.delete}
            label={t("Delete worktree")}
            disabled={!enabled || tree.locked || !tree.branch}
            title={
              tree.locked
                ? t("Unlock this worktree in Git first")
                : !tree.branch
                  ? t("Create a branch before deleting this detached worktree")
                  : t("Delete worktree")
            }
            onClick={() => requestWorktreeManagement(cwd, tree.path)}
          >
            <Trash2 aria-hidden className="size-3.5" />
          </Button>
        ) : (
          <span className={styles.deleteSlot} aria-hidden />
        )}
      </li>
    );
  };
  return (
    <div className={styles.list} data-checkout-list>
      <ul>{groups.primary.map(row)}</ul>
      {groups.active.length ? (
        <>
          <div className={styles.heading}>
            {t("Other worktrees ({p0})", { p0: groups.active.length })}
          </div>
          <ul>{groups.active.map(row)}</ul>
        </>
      ) : null}
      {groups.idle.length ? (
        <>
          <Button
            variant="item"
            motion="none"
            className={styles.heading}
            aria-expanded={idleOpen}
            onClick={() => setIdleOpen((open) => !open)}
          >
            {idleOpen ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            {t("Idle ({p0})", { p0: groups.idle.length })}
          </Button>
          {idleOpen ? <ul>{groups.idle.map(row)}</ul> : null}
        </>
      ) : null}
    </div>
  );
}

/** Fixed-width numeric column so counts line up across rows; empty when zero. */
function Stat({ icon, count, label }: { icon: ReactNode; count: number; label: string }) {
  if (!count) return <span className={styles.stat} aria-hidden />;
  return (
    <span className={styles.stat} role="img" title={label} aria-label={label}>
      {icon}
      {count}
    </span>
  );
}
