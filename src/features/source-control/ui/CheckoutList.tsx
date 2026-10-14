import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown, ChevronRight, Lock, Trash2 } from "../../../shared/ui/icons";
import { requestWorktreeManagement } from "../model/worktreeManagement";
import {
  checkoutTitle,
  folderName,
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
  const [idleOpen, setIdleOpen] = useState(false);
  const groups = groupCheckouts(worktrees, cwd);
  const current = sessionCheckout(
    cwd,
    worktrees.map((tree) => tree.path),
  );
  const row = (tree: Worktree) => {
    const isSession = !!current && pathKey(tree.path) === pathKey(current);
    const unpushed = tree.unpushed ?? 0;
    return (
      <li key={tree.path} className="flex min-w-0 items-center">
        <Button
          variant="item"
          motion="none"
          className={`${styles.row} min-w-0 flex-1`}
          data-session={isSession || undefined}
          title={tree.path}
          onClick={() => onSelect(tree.path)}
        >
          <span className={styles.identity}>
            <span className={styles.branch}>{checkoutTitle(tree)}</span>
            <span className={styles.folder}>
              {tree.isMain ? `${t("Main folder")} · ` : ""}
              {folderName(tree.path)}
            </span>
          </span>
          <span className={styles.badges}>
            {isSession ? <span className={styles.session}>{t("This session")}</span> : null}
            {tree.dirty ? (
              <span
                role="img"
                className={styles.dirty}
                title={t("Uncommitted changes")}
                aria-label={t("Uncommitted changes")}
              />
            ) : null}
            {unpushed > 0 ? (
              <span
                title={t(unpushed === 1 ? "{p0} unpushed commit" : "{p0} unpushed commits", {
                  p0: unpushed,
                })}
              >
                ↑{unpushed}
              </span>
            ) : null}
            {tree.sessionIds.length ? (
              <span>
                {t(tree.sessionIds.length === 1 ? "{p0} session" : "{p0} sessions", {
                  p0: tree.sessionIds.length,
                })}
              </span>
            ) : null}
            {tree.locked ? (
              <span role="img" title={t("Locked")} aria-label={t("Locked")}>
                <Lock className="size-3" />
              </span>
            ) : null}
          </span>
        </Button>
        {!tree.isMain ? (
          <Button variant="ghost" iconOnly label={t("Delete worktree")}
            disabled={!enabled || tree.locked || !tree.branch}
            title={tree.locked ? t("Unlock this worktree in Git first") : !tree.branch ? t("Create a branch before deleting this detached worktree") : t("Delete worktree")}
            onClick={() => requestWorktreeManagement(cwd, tree.path)}>
            <Trash2 aria-hidden className="size-3.5" />
          </Button>
        ) : null}
      </li>
    );
  };
  return (
    <div className={styles.list} data-checkout-list>
      <ul>{[...groups.primary, ...groups.active].map(row)}</ul>
      {groups.idle.length ? (
        <>
          <Button
            variant="item"
            motion="none"
            className={styles.group}
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
