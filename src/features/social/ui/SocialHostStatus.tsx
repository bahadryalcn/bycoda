import { useContext as useSocialContext } from "react";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { useRef, useState } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";

/** Scheduling host status pill with its explanatory popover. */
export function HostStatus({
  label,
  online,
  ready,
  updatedAt,
}: {
  label: string;
  online: boolean;
  ready: boolean;
  updatedAt: number;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="social-scheduling-help" data-ready={ready || undefined}>
      <Button
        disabled={socialLocked}
        ref={trigger}
        variant="ghost"
        size="sm"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <StatusDot size="compact" tone={online ? "success" : "secondary"} preserveColors />
        <span className="social-host-label">{label}</span>
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          align="end"
          width={320}
          role="dialog"
          aria-label={t("Scheduling status")}
          onDismiss={() => setOpen(false)}
          className="social-help-popover"
        >
          <strong>{label}</strong>
          {updatedAt ? (
            <p>
              {t("Last refresh {p0}", {
                p0: formatDate(updatedAt, { hour: "2-digit", minute: "2-digit" }),
              })}
            </p>
          ) : null}
          <strong>{t("How scheduling works")}</strong>
          <p>
            {t(
              "Scheduled jobs run while the selected computer is on and the bycoda service is connected. You can close this screen.",
            )}
          </p>
          <p>
            {t(
              "Publishing needs content approval or an active rule. Jobs wait while the computer is offline.",
            )}
          </p>
        </Popover>
      ) : null}
    </div>
  );
}
