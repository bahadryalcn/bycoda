/** Different job: Mute commands open a separate custom-deadline form; command menu and date field keep their shared owners. */
import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { LiveText } from "../../../shared/ui/LiveText";
import { useRef, useState } from "react";
import { useNotificationPreferencesView } from "../hooks/useProjectNotificationPreferences";
import { notificationMuteActions, notificationMuteDeadline } from "./notificationMuteActions";
import { notificationMuteLabel } from "./notificationMuteLabel";
import { NotificationMuteDatePicker } from "./NotificationMuteDatePicker";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { Popover } from "../../../shared/ui/Popover";
import { BellOff } from "../../../shared/ui/icons";
import { updateNotificationPreferences } from "../model/notificationPreferences";

/** Width of the duration menu; its left edge is placed from the trigger's right edge. */
const MENU_WIDTH = 244;

type Props = {
  projectIds: readonly string[];
  onChanged?: () => void;
  /** Row presentation: one icon trigger; the status is already stated by the row itself. */
  compact?: boolean;
};

export function NotificationMuteControl({ projectIds, onChanged, compact = false }: Props) {
  const t = useT();
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<"menu" | "custom" | null>(null);
  const targetKey = JSON.stringify([...new Set(projectIds)].sort());
  const [previousTargetKey, setPreviousTargetKey] = useState(targetKey);
  if (previousTargetKey !== targetKey) {
    setPreviousTargetKey(targetKey);
    setOpen(null);
    setProblem(null);
  }
  const trigger = useRef<HTMLButtonElement>(null);
  const { preferences, muted: mutedIds, unavailable } = useNotificationPreferencesView();
  const muted = projectIds.filter((id) => mutedIds.has(id));
  const status =
    muted.length === 0
      ? null
      : projectIds.length > 1
        ? t("{p0} of {p1} projects muted", { p0: muted.length, p1: projectIds.length })
        : notificationMuteLabel(preferences[projectIds[0]], t);

  const unavailableReason = t("Saved project notification choices could not be read.");
  const menuOpen = open === "custom" || (open === "menu" && !unavailable);

  const close = (restoreFocus = true) => {
    setOpen(null);
    if (restoreFocus) trigger.current?.focus();
  };
  const change = (mutedUntil: number | null | undefined) => {
    if (!projectIds.length || unavailable) return;
    try {
      updateNotificationPreferences(projectIds, { mutedUntil });
      setProblem(null);
      close();
      onChanged?.();
    } catch {
      setProblem(t("Could not save notification preferences. Please try again."));
    }
  };

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {status && !compact ? <LiveText text={status} size="caption" tone="secondary" /> : null}
      {muted.length ? (
        <Button
          type="button"
          variant="ghost"
          disabled={unavailable}
          disabledReason={unavailableReason}
          onClick={() => change(undefined)}
        >
          {t("Resume notifications")}
        </Button>
      ) : null}
      {compact ? (
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          iconOnly
          label={muted.length ? t("Change mute duration") : t("Mute notifications")}
          aria-haspopup={open === "custom" ? "dialog" : "menu"}
          aria-expanded={menuOpen}
          disabled={!projectIds.length || unavailable}
          disabledReason={projectIds.length ? unavailableReason : t("Choose a project first.")}
          onClick={() => setOpen(open ? null : "menu")}
        >
          <BellOff className="icon-sm" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          ref={trigger}
          type="button"
          variant="secondary"
          aria-haspopup={open === "custom" ? "dialog" : "menu"}
          expanded={menuOpen}
          disabled={!projectIds.length || unavailable}
          disabledReason={projectIds.length ? unavailableReason : t("Choose a project first.")}
          onClick={() => setOpen(open ? null : "menu")}
        >
          <BellOff className="icon-sm" aria-hidden="true" />
          {t("Mute")}
        </Button>
      )}
      {problem ? (
        <Alert tone="danger" className="w-full">
          {problem}
        </Alert>
      ) : null}
      {open === "menu" && !unavailable && trigger.current ? (
        <ExplorerMenu
          x={trigger.current.getBoundingClientRect().right - MENU_WIDTH}
          y={trigger.current.getBoundingClientRect().bottom + 4}
          ariaLabel={t("Mute notifications")}
          width={MENU_WIDTH}
          header={
            <Text as="p" size="micro" tone="secondary" className="px-2 py-1.5">
              {t("Mute all notifications for")}
            </Text>
          }
          items={notificationMuteActions()}
          onClose={() => close(Boolean(document.activeElement?.closest('[role="menu"]')))}
          onPick={(id) => {
            if (id === "mute:custom") {
              setOpen("custom");
              return;
            }
            const deadline = notificationMuteDeadline(id);
            if (deadline !== undefined) change(deadline);
          }}
        />
      ) : null}
      {open === "custom" ? (
        <Popover
          anchor={trigger}
          align="end"
          width={360}
          kind="dialog"
          aria-label={t("Mute project notifications")}
          onDismiss={(reason) => close(reason === "escape")}
          variant="panel"
        >
          <NotificationMuteDatePicker
            projectIds={projectIds}
            onCancel={() => close()}
            onChanged={() => {
              close();
              onChanged?.();
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}
