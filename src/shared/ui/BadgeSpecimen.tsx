import { useT } from "../i18n";
import { Badge, StatusBadge } from "./Badge";
import { StatusDot } from "./StatusDot";

/** Real shared-control reference for counts, attention and running work. */
export function BadgeSpecimen({
  label,
  labelsOnly = false,
}: {
  label?: string;
  labelsOnly?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2" data-badge-specimen>
      {!labelsOnly && (
        <>
          {[0, 1, 99, 128].map((count) => (
            <Badge key={count} variant="count" size="xs">
              {count}
            </Badge>
          ))}
          <StatusDot label={t("Running")} />
          <StatusBadge status="running" size="xs" />
          <Badge tone="warning" size="xs">
            {t("Question")}
          </Badge>
        </>
      )}
      {(["neutral", "accent", "info", "success", "warning", "danger"] as const).map((tone) => (
        <Badge key={tone} tone={tone} size="xs">
          {label ?? tone}
        </Badge>
      ))}
    </div>
  );
}
