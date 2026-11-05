import { useT } from "../i18n";
import { Badge } from "./Badge";

export type CapabilityPermission = "enabled" | "disabled" | "unknown";
export type CapabilityReadiness = "ready" | "unavailable" | "checking" | "unknown";
export type CapabilityActivity = "running" | "idle" | "unknown";

export interface CapabilityStatusProps {
  permission: CapabilityPermission;
  readiness: CapabilityReadiness;
  activity: CapabilityActivity;
  className?: string;
}

/** Independent observations. Callers must invalidate runtime facts after failed reads. */
export function CapabilityStatus({
  permission,
  readiness,
  activity,
  className,
}: CapabilityStatusProps) {
  const t = useT();
  const axes = [
    {
      axis: "permission",
      label: t("Permission"),
      value: permission,
      text:
        permission === "enabled"
          ? t("Enabled")
          : permission === "disabled"
            ? t("Disabled")
            : t("Unknown"),
    },
    {
      axis: "readiness",
      label: t("Readiness"),
      value: readiness,
      text:
        readiness === "ready"
          ? t("Verified ready")
          : readiness === "unavailable"
            ? t("Unavailable")
            : readiness === "checking"
              ? t("Checking")
              : t("Unknown"),
    },
    {
      axis: "activity",
      label: t("Activity"),
      value: activity,
      text: activity === "running" ? t("Running") : activity === "idle" ? t("Idle") : t("Unknown"),
    },
  ];
  return (
    <dl
      className={["flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-ui-caption", className]
        .filter(Boolean)
        .join(" ")}
      data-capability-status=""
    >
      {axes.map(({ axis, label, value, text }) => (
        <div
          key={axis}
          className="flex min-w-0 shrink-0 items-center gap-1"
          data-capability-axis={axis}
          data-state={value}
        >
          <dt className="text-(--ui-text-secondary)">{label}</dt>
          <dd className="m-0 shrink-0">
            <Badge
              key={value}
              className="whitespace-nowrap"
              size="xs"
              tone={
                axis === "activity" && value === "running"
                  ? "accent"
                  : axis === "readiness" && value === "ready"
                    ? "success"
                    : "neutral"
              }
            >
              {text}
            </Badge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
