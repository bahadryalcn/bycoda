import { t, useLocale } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Modal } from "../../shared/ui/Modal";
import { ArrowDownCircle, Loader } from "../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { claimStartupUpdatePrompt, installAppUpdate, useAppUpdater } from "../model/useAppUpdater";
import { type UpdaterSnapshot } from "../model/updater";
import type { InstalledUpdate } from "../model/updateNotice";
import { snoozeUpdatePrompt } from "../model/updatePrompt";
import { UpdateRailCard } from "./UpdateRailCard";

// The update entry point only earns its space when there is something to act on: an
// update waiting to be installed, one downloading, or an install error to retry.
// Background checks stay silent; manual checks live in Settings and the app menu.
export function isSidebarUpdateActionable(snapshot: UpdaterSnapshot): boolean {
  return (
    snapshot.phase === "available" ||
    snapshot.phase === "downloading" ||
    (snapshot.phase === "error" && !!snapshot.availableVersion)
  );
}

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
  noticesOnly = false,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
  noticesOnly?: boolean;
}) {
  useLocale();
  const [promptOpen, setPromptOpen] = useState(false);
  const { snapshot, notes, setSnapshot } = useAppUpdater();
  const dismissPrompt = () => {
    snoozeUpdatePrompt();
    setPromptOpen(false);
  };

  useEffect(() => {
    if (noticesOnly || snapshot.phase !== "available") return;
    let active = true;
    queueMicrotask(() => {
      if (active && claimStartupUpdatePrompt()) setPromptOpen(true);
    });
    return () => {
      active = false;
    };
  }, [noticesOnly, snapshot]);

  const card =
    update && onOpenWhatsNew && onDismissUpdate ? (
      <UpdateRailCard update={update} onOpen={onOpenWhatsNew} onDismiss={onDismissUpdate} />
    ) : null;
  const actionable = isSidebarUpdateActionable(snapshot);

  if (noticesOnly) return card;
  if (!card && !actionable) return null;

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      {promptOpen && actionable ? (
        <Modal
          title={snapshot.phase === "error" ? t("Retry") : t("Update available")}
          size="sm"
          onClose={dismissPrompt}
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-content">
              v{snapshot.currentVersion} → v{snapshot.availableVersion}
            </p>
            {snapshot.error ? (
              <p role="alert" className="text-sm text-content">
                {snapshot.error}
              </p>
            ) : null}
            {notes ? (
              <details className="text-sm text-content">
                <summary className="cursor-pointer">{t("Release notes")}</summary>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm [margin-block-start:0.5rem]">
                  {notes}
                </pre>
              </details>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={dismissPrompt}>{`${t("Later")} (${t("24 hours")})`}</Button>
              <SidebarUpdate snapshot={snapshot} onSnapshot={setSnapshot} compact />
            </div>
          </div>
        </Modal>
      ) : null}
      {card}
      {actionable ? (
        <Button
          iconOnly
          shape="pill"
          variant="secondary"
          tone={snapshot.phase === "error" ? "warning" : "neutral"}
          label={
            snapshot.phase === "downloading"
              ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
              : t("Update to {p0}", { p0: snapshot.availableVersion })
          }
          tooltip={
            snapshot.phase === "downloading"
              ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
              : t("Update to {p0}", { p0: snapshot.availableVersion })
          }
          aria-haspopup="dialog"
          aria-expanded={promptOpen}
          onClick={() => setPromptOpen(true)}
        >
          {snapshot.phase === "downloading" && snapshot.progress != null ? (
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" stroke="var(--color-stroke)" />
              <circle
                cx="12"
                cy="12"
                r="10"
                pathLength="100"
                strokeDasharray={`${snapshot.progress} 100`}
                transform="rotate(-90 12 12)"
              />
              <path d="M12 6v10m-4-4 4 4 4-4" />
            </svg>
          ) : snapshot.phase === "downloading" ? (
            <Loader className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : (
            <ArrowDownCircle className="size-4" aria-hidden />
          )}
        </Button>
      ) : null}
    </div>
  );
}

export function SidebarUpdate({
  snapshot,
  onSnapshot,
  compact = false,
}: {
  snapshot: UpdaterSnapshot;
  onSnapshot: (next: UpdaterSnapshot) => void;
  compact?: boolean;
}) {
  useLocale();
  const busy = snapshot.phase === "downloading";
  // `busy` only flips after installPendingUpdate awaits readAppVersion, so a
  // second click can still land. The ref closes that window immediately.
  const installing = useRef(false);

  const onClick = useCallback(async () => {
    if (busy || installing.current) return;
    installing.current = true;
    try {
      await installAppUpdate(onSnapshot);
    } finally {
      installing.current = false;
    }
  }, [busy, onSnapshot]);

  const label = busy
    ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
    : t("Update to {p0}", { p0: snapshot.availableVersion ?? "" });

  return (
    <Button
      onClick={onClick}
      disabled={busy}
      variant="secondary"
      fullWidth={!compact}
      motion="none"
      label={label}
      tooltip={label}
    >
      <span className="grid size-[18px] shrink-0 place-items-center">
        {busy ? (
          <Loader className="size-4 motion-safe:animate-spin opacity-70" aria-hidden />
        ) : (
          <ArrowDownCircle className="size-4 text-accent" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="block truncate text-[12px] font-medium leading-tight">{label}</span>
        {!compact ? (
          <span className="ms-auto block shrink-0 text-[11px] text-muted">
            v{snapshot.currentVersion}
          </span>
        ) : null}
      </span>
    </Button>
  );
}
