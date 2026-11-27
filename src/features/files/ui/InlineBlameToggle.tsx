import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { useSyncExternalStore } from "react";
import { isRemoteProjectPath } from "../../projects/public/recents";
import {
  GIT_ACTIONS,
  HOST_UPDATE_NOTICE,
  useRemoteSupports,
} from "../../connections/public/remoteCapabilities";
import {
  loadInlineBlame,
  saveInlineBlame,
  subscribeInlineBlame,
} from "../../settings/public/settings";
import { displayPath } from "../../../shared/lib/paths";
import { UserRound } from "../../../shared/ui/icons";

/** The inline blame preference, shared by every open editor. */
export function useInlineBlame(): boolean {
  return useSyncExternalStore(subscribeInlineBlame, loadInlineBlame, loadInlineBlame);
}

/**
 * Why blame cannot run for this file, or null when it can. Whether git tracks
 * the file is only known once git answers, and shows up as a quiet message.
 * `remoteGit` is whether a remote project's host supports `git.actions`
 * (undefined while it has not said); it only matters for remote projects.
 */
export function inlineBlameUnavailableReason(
  cwd: string,
  path: string,
  remoteGit?: boolean,
): string | null {
  if ((isRemoteProjectPath(cwd) || isRemoteProjectPath(path)) && remoteGit !== true) {
    return remoteGit === false
      ? HOST_UPDATE_NOTICE
      : "Checking whether this machine supports blame…";
  }
  const relative = displayPath(path, cwd);
  if (!cwd || cwd === "~" || !relative || relative === path) {
    return "Blame needs a file inside a git project";
  }
  return null;
}

/** `inlineBlameUnavailableReason`, asking a remote project's machine what it supports. */
export function useInlineBlameUnavailableReason(cwd: string, path: string): string | null {
  const remoteGit = useRemoteSupports(cwd, GIT_ACTIONS);
  return inlineBlameUnavailableReason(cwd, path, remoteGit);
}

/** Turns the editor's per-line blame gutter on and off. */
export function InlineBlameToggle({ reason }: { reason: string | null }) {
  useLocale();
  const on = useInlineBlame() && !reason;
  return (
    <Button
      size="sm"
      variant="ghost"
      iconOnly
      label={t("Git blame")}
      pressed={on}
      disabled={reason !== null}
      disabledReason={reason ?? undefined}
      // Keep the caret where it is in the editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => saveInlineBlame(!on)}
    >
      <UserRound className="icon-sm" strokeWidth={1.75} />
    </Button>
  );
}
