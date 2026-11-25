import { Text } from "../../shared/ui/Text";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Modal, ModalActions } from "../../shared/ui/Modal";
import { ArrowDownCircle, ArrowRight, Download, RefreshCw } from "../../shared/ui/icons";
import { InlineError } from "../../shared/ui/InlineError";
import { Spinner } from "../../shared/ui/Spinner";
import { StatusDot } from "../../shared/ui/StatusDot";
import { Divider } from "../../shared/ui/Divider";
import { useEffect, useRef, useState } from "react";
import { claimStartupUpdatePrompt, installAppUpdate, useAppUpdater } from "../model/useAppUpdater";
import { type UpdaterSnapshot } from "../model/updater";
import type { InstalledUpdate } from "../model/updateNotice";
import { snoozeUpdatePrompt } from "../model/updatePrompt";
import { UpdateRailCard } from "./UpdateRailCard";
import { GithubStarPrompt } from "./GithubStarPrompt";
import { Disclosure } from "../../shared/ui/Disclosure";

// The update entry point only earns its space when there is something to act on: an
// update waiting to be installed, one downloading, or any updater error: a failed
// install or check must stay visible even when no version was found.
// Background checks stay silent; manual checks live in Settings and the app menu.
export function isSidebarUpdateActionable(snapshot: UpdaterSnapshot): boolean {
  return (
    snapshot.phase === "available" || snapshot.phase === "downloading" || snapshot.phase === "error"
  );
}

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
  noticesOnly = false,
  inlineNotice = false,
  icon = false,
  compact = false,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
  noticesOnly?: boolean;
  inlineNotice?: boolean;
  /** Legacy fixture option; repository prompts now live inside the update dialog. */
  repositoryPrompt?: boolean;
  /** Footer icon button: only the download icon (dot while an update waits) and its dialog. */
  icon?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const [promptOpen, setPromptOpen] = useState(false);
  const { snapshot, notes, setSnapshot } = useAppUpdater();
  // Only the reminder action snoozes. Dismissal and failures leave reminders unchanged.
  const canSnooze = snapshot.phase !== "error";
  const closePrompt = () => setPromptOpen(false);
  const onLaterPrompt = () => {
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
      <UpdateRailCard
        update={update}
        onOpen={onOpenWhatsNew}
        onDismiss={onDismissUpdate}
        inline={inlineNotice}
      />
    ) : null;
  const actionable = isSidebarUpdateActionable(snapshot);
  const actionLabel =
    snapshot.phase === "downloading"
      ? `${t("Downloading")}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
      : snapshot.phase === "error"
        ? t("Update failed")
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
          title={snapshot.phase === "error" ? t("Update failed") : t("Update available")}
          size="sm"
          onClose={closePrompt}
          footer={
            <ModalActions
              start={
                <Button variant="ghost" onClick={canSnooze ? onLaterPrompt : closePrompt}>
                  {canSnooze ? t("Remind me tomorrow") : t("Close")}
                </Button>
              }
            >
              {snapshot.availableVersion ? (
                <SidebarUpdate snapshot={snapshot} onSnapshot={setSnapshot} compact />
              ) : null}
            </ModalActions>
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 empty:hidden">
              {snapshot.availableVersion ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Text size="secondary" tone="secondary" wrap="anywhere">
                    v{snapshot.currentVersion}
                  </Text>
                  <ArrowRight className="icon-sm shrink-0 rtl:rotate-180" />
                  <Text as="strong" size="heading" tone="primary" weight="medium" wrap="anywhere">
                    v{snapshot.availableVersion}
                  </Text>
                </div>
              ) : null}
              <GithubStarPrompt oncePerVersion version={snapshot.currentVersion} />
            </div>
            {snapshot.error ? <InlineError>{snapshot.error}</InlineError> : null}
            {notes ? (
              <>
                <Divider decorative />
                <Disclosure
                  summary={t("Release notes")}
                  defaultOpen
                  chevron="end"
                  weight="medium"
                  tone="primary"
                  interactionTone="accent"
                >
                  <AgentMarkdown className="whats-new-md" text={notes} streaming={false} />
                </Disclosure>
              </>
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
      size={compact ? "lg" : undefined}
      fullWidth={!compact}
      motion="none"
      label={label}
      startIcon={busy ? <Spinner size="md" /> : <Download className="icon-md" />}
      aria-busy={busy || undefined}
      tooltip={label}
      tooltipWhen="overflow"
    >
      {compact ? (
        label
      ) : (
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
          <Text as="span" size="micro" tone="inherit" className="ms-auto block shrink-0">
            v{snapshot.currentVersion}
          </Text>
        </span>
      )}
    </Button>
  );
}
