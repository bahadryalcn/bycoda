import { t, useLocale } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Modal } from "../../shared/ui/Modal";
import { ArrowDownCircle, Loader } from "../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  type UpdaterSnapshot,
} from "../model/updater";
import type { InstalledUpdate } from "../model/updateNotice";
import { UpdateRailCard } from "./UpdateRailCard";

// The sidebar row only earns its space when there is something to act on: an
// update waiting to be installed, or one already downloading. Every other phase
// — including a probe that failed — stays silent, because manual "Check for
// updates" already lives in Settings and the app menu.
export function isSidebarUpdateActionable(snapshot: UpdaterSnapshot): boolean {
  return snapshot.phase === "available" || snapshot.phase === "downloading";
}

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
}) {
  useLocale();
  const [promptOpen, setPromptOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const prompted = useRef(false);
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });
  const phaseRef = useRef(snapshot.phase);
  phaseRef.current = snapshot.phase;

  // The automatic probe runs on mount whether or not it ends up rendering
  // anything, so a newly published version still surfaces on its own. The
  // snapshot lives here rather than in SidebarUpdate so the footer can drop its
  // padding entirely when neither child has anything to show.
  useEffect(() => {
    let cancelled = false;
    let checking = false;

    const probe = async () => {
      if (checking || phaseRef.current === "downloading") return;
      checking = true;
      try {
        const currentVersion = await readAppVersion();
        if (cancelled) return;
        if (phaseRef.current !== "available") setSnapshot({ phase: "checking", currentVersion });

        try {
          const update = await probeForUpdate();
          if (cancelled) return;
          if (update) {
            setNotes(update.body?.trim() ?? "");
            if (!prompted.current) {
              prompted.current = true;
              setPromptOpen(true);
            }
            setSnapshot({
              phase: "available",
              currentVersion,
              availableVersion: update.version,
            });
            return;
          }
          setSnapshot({ phase: "current", currentVersion });
        } catch {
          if (cancelled) return;
          setSnapshot((previous) =>
            previous.phase === "available" ? previous : { phase: "idle", currentVersion },
          );
        }
      } finally {
        checking = false;
      }
    };
    void probe();
    const interval = window.setInterval(() => void probe(), 30 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const card =
    update && onOpenWhatsNew && onDismissUpdate ? (
      <UpdateRailCard update={update} onOpen={onOpenWhatsNew} onDismiss={onDismissUpdate} />
    ) : null;
  const actionable = isSidebarUpdateActionable(snapshot);

  if (!card && !actionable) return null;

  // The gap down to the Settings block belongs to that block's own padding, so
  // the footer can disappear without leaving the sidebar's bottom row flush
  // against the scrolling list above it.
  return (
    <div className="flex flex-col gap-1.5 p-2 pb-0">
      {promptOpen && actionable ? (
        <Modal title={t("Update available")} size="sm" onClose={() => setPromptOpen(false)}>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-content">
              v{snapshot.currentVersion} → v{snapshot.availableVersion}
            </p>
            {notes ? (
              <details className="text-sm text-content">
                <summary className="cursor-pointer">{t("Release notes")}</summary>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm [margin-block-start:0.5rem]">
                  {notes}
                </pre>
              </details>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setPromptOpen(false)}>{t("Later")}</Button>
              <SidebarUpdate snapshot={snapshot} onSnapshot={setSnapshot} />
            </div>
          </div>
        </Modal>
      ) : null}
      {card}
      {actionable ? <SidebarUpdate snapshot={snapshot} onSnapshot={setSnapshot} /> : null}
    </div>
  );
}

export function SidebarUpdate({
  snapshot,
  onSnapshot,
}: {
  snapshot: UpdaterSnapshot;
  onSnapshot: (next: UpdaterSnapshot) => void;
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
      await installPendingUpdate(onSnapshot);
    } finally {
      installing.current = false;
    }
  }, [busy, onSnapshot]);

  const label = busy
    ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
    : t("Update to {p0}", { p0: snapshot.availableVersion ?? "" });

  return (
    <Button onClick={onClick} disabled={busy} variant="secondary" fullWidth motion="none">
      <span className="grid size-[18px] shrink-0 place-items-center">
        {busy ? (
          <Loader className="size-4 motion-safe:animate-spin opacity-70" aria-hidden />
        ) : (
          <ArrowDownCircle className="size-4 text-accent" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1 flex items-center">
        <span className="block truncate text-[12px] font-medium leading-tight">{label}</span>
        <span className="ml-auto block text-[11px] text-content/40">
          v{snapshot.currentVersion}
        </span>
      </span>
    </Button>
  );
}
