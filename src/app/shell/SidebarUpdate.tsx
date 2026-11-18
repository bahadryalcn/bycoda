import { Text } from "../../shared/ui/Text";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Modal, ModalActions } from "../../shared/ui/Modal";
import { ArrowDownCircle, RefreshCw } from "../../shared/ui/icons";
import { InlineError } from "../../shared/ui/InlineError";
import { Spinner } from "../../shared/ui/Spinner";
import { StatusDot } from "../../shared/ui/StatusDot";
import { useEffect, useRef, useState } from "react";
import { claimStartupUpdatePrompt, installAppUpdate, useAppUpdater } from "../model/useAppUpdater";
import { type UpdaterSnapshot } from "../model/updater";
import type { InstalledUpdate } from "../model/updateNotice";
import { snoozeUpdatePrompt } from "../model/updatePrompt";
import { UpdateRailCard } from "./UpdateRailCard";
import { GithubStarPrompt } from "./GithubStarPrompt";
import { Disclosure } from "../../shared/ui/Disclosure";

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
  icon = false,
  compact = false,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
  noticesOnly?: boolean;
  /** Legacy fixture option; repository prompts now live inside the update dialog. */
  repositoryPrompt?: boolean;
  /** Footer icon button: only the download icon (dot while an update waits) and its dialog. */
  icon?: boolean;
  compact?: boolean;
}) {
  const t = useT();
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
  const actionLabel =
    snapshot.phase === "downloading"
      ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
      : t("Update to {p0}", { p0: snapshot.availableVersion });

  if (noticesOnly) return card;
  if (!card && !actionable && !icon) return null;
  if (icon && !actionable) return null;

  const actionText =
    snapshot.phase === "downloading"
      ? snapshot.progress != null
        ? `${snapshot.progress}%`
        : t("Downloading")
      : t("Update");
  const actionIcon =
    snapshot.phase === "downloading" ? (
      <Spinner size="md" className="shrink-0" />
    ) : icon ? (
      <span className="relative grid icon-md shrink-0 place-items-center">
        <ArrowDownCircle className="icon-md" aria-hidden />
        <StatusDot
          tone={snapshot.phase === "error" ? "warning" : "accent"}
          appearance="solid"
          size="compact"
          className="absolute -end-0.5 -top-0.5"
        />
      </span>
    ) : (
      <RefreshCw className="icon-md shrink-0" aria-hidden />
    );

  const updateAction = actionable ? (
    <Button
      {...(icon && !compact
        ? { label: actionLabel, revealLabel: true, startIcon: actionIcon }
        : icon
          ? { iconOnly: true as const, label: actionLabel }
          : { label: actionLabel })}
      variant={icon ? "ghost" : "secondary"}
      tone={snapshot.phase === "error" ? "warning" : "neutral"}
      motion="none"
      tooltip={actionLabel}
      aria-haspopup="dialog"
      aria-expanded={promptOpen}
      onClick={() => setPromptOpen(true)}
      className="min-w-0"
    >
      {icon && !compact ? (
        actionText
      ) : (
        <>
          {actionIcon}
          {!icon ? (
            <Text
              size="caption"
              tone="inherit"
              weight="medium"
              leading="tight"
              truncate
              className="@max-[140px]/rail:hidden"
            >
              {actionText}
            </Text>
          ) : null}
        </>
      )}
    </Button>
  ) : null;

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 empty:hidden ${icon ? "shrink-0" : "items-end"}`}
    >
      {promptOpen && actionable ? (
        <Modal
          title={snapshot.phase === "error" ? t("Retry") : t("Update available")}
          size="sm"
          onClose={dismissPrompt}
          footer={
            <ModalActions>
              <Button variant="ghost" tooltip={t("24 hours")} onClick={dismissPrompt}>
                {t("Later")}
              </Button>
              <SidebarUpdate snapshot={snapshot} onSnapshot={setSnapshot} compact />
            </ModalActions>
          }
        >
          <div className="flex flex-col gap-3">
            <GithubStarPrompt oncePerVersion version={snapshot.currentVersion} />
            <Text as="p" size="body" tone="primary">
              v{snapshot.currentVersion} → v{snapshot.availableVersion}
            </Text>
            {snapshot.error ? <InlineError>{snapshot.error}</InlineError> : null}
            {notes ? (
              <Disclosure summary={t("Release notes")} defaultOpen>
                <div className="max-h-64 overflow-y-auto [margin-block-start:0.5rem]">
                  <AgentMarkdown className="whats-new-md" text={notes} streaming={false} />
                </div>
              </Disclosure>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {card}
      {updateAction}
    </div>
  );
}

/** Installs the update, then `release`s the click guard even when the install rejects. */
async function installThenRelease(
  onSnapshot: (next: UpdaterSnapshot) => void,
  release: () => void,
): Promise<void> {
  try {
    await installAppUpdate(onSnapshot);
  } finally {
    release();
  }
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
  const t = useT();
  const busy = snapshot.phase === "downloading";
  // `busy` only flips after installPendingUpdate awaits readAppVersion, so a
  // second click can still land. The ref closes that window immediately.
  const installing = useRef(false);

  const onClick = async () => {
    if (busy || installing.current) return;
    installing.current = true;
    await installThenRelease(onSnapshot, () => {
      installing.current = false;
    });
  };

  const label = busy
    ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
    : t("Update to {p0}", { p0: snapshot.availableVersion ?? "" });

  return (
    <Button
      onClick={onClick}
      disabled={busy}
      variant="primary"
      fullWidth={!compact}
      motion="none"
      label={label}
      tooltip={label}
      tooltipWhen="overflow"
    >
      <span className="icon-md grid shrink-0 place-items-center">
        {busy ? (
          <Spinner size="md" className="opacity-70" />
        ) : (
          <ArrowDownCircle className="icon-md" tone="accent" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Text
          size="caption"
          tone="inherit"
          weight="medium"
          leading="tight"
          truncate
          className="block"
        >
          {label}
        </Text>
        {!compact ? (
          <Text as="span" size="micro" tone="inherit" className="ms-auto block shrink-0">
            v{snapshot.currentVersion}
          </Text>
        ) : null}
      </span>
    </Button>
  );
}
