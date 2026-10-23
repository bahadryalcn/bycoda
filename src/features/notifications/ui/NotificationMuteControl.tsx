import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { useRef, useState } from "react";
import { useProjectNotificationPreferences } from "../hooks/useProjectNotificationPreferences";
import {
  notificationMuteActions,
  notificationMuteDeadline,
  notificationMuteStatus,
} from "./notificationMuteActions";
import { NotificationMuteDatePicker } from "./NotificationMuteDatePicker";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { Popover } from "../../../shared/ui/Popover";
import { BellOff, ChevronDown } from "../../../shared/ui/icons";
import { isProjectMuted, updateNotificationPreferences } from "../model/notificationPreferences";

type Props = {
  projectIds: readonly string[];
  onChanged?: () => void;
  /** Row presentation: one icon trigger; the status is already stated by the row itself. */
  compact?: boolean;
};

export function NotificationMuteControl({ projectIds, onChanged, compact = false }: Props) {
  useLocale();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<"menu" | "custom" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const preferences = useProjectNotificationPreferences();
  const muted = projectIds.filter((id) => isProjectMuted(preferences[id] ?? { disabled: [] }));
  const status =
    muted.length === 0
      ? null
      : projectIds.length > 1
        ? `${muted.length} of ${projectIds.length} projects muted`
        : notificationMuteStatus(preferences[projectIds[0]]);

  const close = (restoreFocus = true) => {
    setOpen(null);
    if (restoreFocus) trigger.current?.focus();
  };
  const change = (mutedUntil: number | null | undefined) => {
    if (!projectIds.length) return;
    try {
      updateNotificationPreferences(projectIds, { mutedUntil });
      setError(null);
      close();
      onChanged?.();
    } catch {
      setError("Could not save notification preferences. Please try again.");
    }
  };

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {status && !compact ? (
        <Badge role="status" tone="neutral">
          {status}
        </Badge>
      ) : null}
      {muted.length ? (
        <Button
          type="button"
          aria-label={t("Resume notifications")}
          variant="ghost"
          onClick={() => change(undefined)}
        >
          {t("Resume notifications")}
        </Button>
      ) : null}
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        iconOnly={compact}
        label={muted.length ? t("Change mute duration") : t("Mute notifications")}
        tooltip={compact && status ? status : undefined}
        aria-label={muted.length ? t("Change mute duration") : t("Mute notifications")}
        aria-haspopup={open === "custom" ? "dialog" : "menu"}
        aria-expanded={open !== null}
        disabled={!projectIds.length}
        onClick={() => setOpen(open ? null : "menu")}
      >
        <BellOff className="icon-sm" aria-hidden="true" />
        {compact ? null : (
          <>
            {muted.length ? t("Muted") : t("Mute")}
            <ChevronDown className="icon-xs text-(--ui-text-secondary)" aria-hidden="true" />
          </>
        )}
      </Button>
      {error ? (
        <Alert tone="danger" className="w-full">
          {error}
        </Alert>
      ) : null}
      {open === "menu" && trigger.current ? (
        <ExplorerMenu
          x={trigger.current.getBoundingClientRect().right - 244}
          y={trigger.current.getBoundingClientRect().bottom + 4}
          ariaLabel="Mute notifications"
          width={244}
          header={
            <p className="px-2 py-1.5 text-ui-micro text-(--ui-text-secondary)">
              {t("Mute all notifications for")}
            </p>
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
          role="dialog"
          aria-label={t("Mute project notifications")}
          onDismiss={(reason) => close(reason === "escape")}
          className="overflow-y-auto p-3"
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
