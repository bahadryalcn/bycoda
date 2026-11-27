import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { Folder, FolderTree } from "../../../shared/ui/icons";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import { GitPickerTrigger } from "../../source-control/ui/GitPickerTrigger";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import {
  QUICK_GIT_RESULT,
  type QuickGitKind,
  type QuickGitRequest,
  type QuickGitResult,
} from "../model/quickGitPopup";
import type { WorkspaceMode } from "../../sessions/model/session";
import type { QuickWorkspace } from "../model/quickWorkspace";
import { describeLocalError } from "../../connections/public/remoteFailure";

const workspaceErrorDetails = (error: unknown) => describeLocalError(error, "").trim();

export function QuickWorkspaceControls({
  value,
  resolvedMode = value.mode ?? "current",
  resolvedBase,
  enabled,
  canOpen,
  prepare,
  onChange,
  onOpenChange,
  onClose,
  onError,
}: {
  value: QuickWorkspace;
  resolvedMode?: WorkspaceMode;
  resolvedBase?: string;
  enabled: boolean;
  canOpen?: () => boolean;
  prepare?: (operation: () => Promise<unknown>) => Promise<unknown>;
  onChange: (choice: QuickWorkspace) => void;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  onError?: (error: string) => void;
}) {
  useLocale();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<QuickGitKind | null>(null);
  const activeKind = useRef<QuickGitKind | null>(null);
  const toggleIntent = useRef<QuickGitKind | null>(null);
  const closedByTrigger = useRef<QuickGitKind | null>(null);
  const active = useRef<string | null>(null);
  const props = useRef({ value, onChange, onOpenChange, onClose, onError, canOpen });
  useLayoutEffect(() => {
    props.current = { value, onChange, onOpenChange, onClose, onError, canOpen };
  });
  const cwd = value.tree?.path ?? value.cwd ?? "";
  const { branches, settled, unreachable } = useProjectBranchesState(cwd, enabled && !!cwd);
  const base = value.base || resolvedBase || branches?.current || "HEAD";

  const cancel = () => {
    const id = active.current;
    active.current = null;
    activeKind.current = null;
    toggleIntent.current = null;
    closedByTrigger.current = null;
    setOpen(null);
    props.current.onOpenChange(false);
    if (id)
      void invoke("quick_git_complete", {
        id,
        choice: null,
        restoreFocus: false,
      }).catch(() => undefined);
  };
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listenWindowAsync<QuickGitResult>(QUICK_GIT_RESULT, ({ payload }) => {
      if (disposed || payload.id !== active.current) return;
      closedByTrigger.current = payload.triggerKind ?? null;
      active.current = null;
      activeKind.current = null;
      setOpen(null);
      props.current.onOpenChange(false);
      if (
        payload.choice &&
        payload.choice.cwd === props.current.value.cwd &&
        (props.current.canOpen?.() ?? true)
      )
        props.current.onChange(payload.choice);
      notifyGitChanged();
      if (payload.restoreFocus) props.current.onClose();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          stop = unlisten;
          setReady(true);
        }
      })
      .catch((error) => props.current.onError?.(workspaceErrorDetails(error)));
    return () => {
      disposed = true;
      stop?.();
      const id = active.current;
      active.current = null;
      activeKind.current = null;
      toggleIntent.current = null;
      closedByTrigger.current = null;
      if (id)
        void invoke("quick_git_complete", {
          id,
          choice: null,
          restoreFocus: false,
        }).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);

  const beginClick = (kind: QuickGitKind) => {
    toggleIntent.current = activeKind.current === kind ? kind : null;
  };
  const show = async (kind: QuickGitKind, button: HTMLButtonElement) => {
    const closing =
      activeKind.current === kind ||
      toggleIntent.current === kind ||
      closedByTrigger.current === kind;
    toggleIntent.current = null;
    closedByTrigger.current = null;
    if (closing) {
      cancel();
      return;
    }
    if (!enabled || (canOpen && !canOpen())) return;
    const id = crypto.randomUUID();
    const bounds = button.getBoundingClientRect();
    const request: QuickGitRequest = {
      id,
      kind,
      choice: { ...value, resolvedMode, base: resolvedMode === "worktree" ? base : undefined },
      branches: branches ?? undefined,
      anchor: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };
    active.current = id;
    activeKind.current = kind;
    setOpen(kind);
    onOpenChange(true);
    let actual: Promise<unknown> | undefined;
    const open = () => (actual ??= invoke("quick_git_open", { request }));
    try {
      await (prepare ? prepare(open) : open());
    } catch (error) {
      if (active.current !== id) return;
      active.current = null;
      activeKind.current = null;
      setOpen(null);
      props.current.onOpenChange(false);
      props.current.onError?.(workspaceErrorDetails(error));
    }
  };
  const disabled = !enabled || !ready || !branches?.current;
  const disabledReason = !enabled
    ? t("Close the current picker or wait for the session to start.")
    : !ready
      ? t("Workspace options are unavailable.")
      : unreachable
        ? t("This machine is unreachable")
        : settled && !branches?.current
          ? t("No repo")
          : undefined;
  const Icon = resolvedMode === "worktree" ? FolderTree : Folder;
  const label = resolvedMode === "worktree" ? t("New worktree") : t("Current checkout");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        variant="chip"
        motion="none"
        truncate
        startIcon={<Icon className="icon-sm shrink-0" />}
        disabled={disabled}
        disabledReason={disabledReason}
        loading={!settled && !!cwd && enabled}
        aria-label={t("Workspace {p0}", { p0: label })}
        aria-haspopup="dialog"
        aria-expanded={open === "workspace"}
        onMouseDown={(event) => {
          event.preventDefault();
          beginClick("workspace");
        }}
        onClick={(event) => void show("workspace", event.currentTarget)}
        className="min-w-0 max-w-48"
      >
        {label}
      </Button>
      <GitPickerTrigger
        label={
          resolvedMode === "worktree"
            ? t("From {p0}", { p0: base })
            : branches?.current ||
              (unreachable ? t("Unavailable") : settled ? t("No repo") : t("Loading…"))
        }
        title={unreachable ? t("This machine is unreachable") : undefined}
        aria-label={
          resolvedMode === "worktree"
            ? t("Create worktree from {p0}", { p0: base })
            : t("Choose branch")
        }
        aria-haspopup="dialog"
        aria-expanded={open === "branch" || open === "base"}
        loading={!settled}
        disabled={disabled}
        disabledReason={disabledReason}
        worktree={!!value.tree && !value.tree.isMain}
        onMouseDown={(event) => {
          event.preventDefault();
          beginClick(resolvedMode === "worktree" ? "base" : "branch");
        }}
        onClick={(event) =>
          void show(resolvedMode === "worktree" ? "base" : "branch", event.currentTarget)
        }
      />
    </div>
  );
}
