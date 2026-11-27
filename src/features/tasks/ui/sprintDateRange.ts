import type { useT } from "../../../shared/i18n";
import { displayDate } from "../model/sprintDates";

/** "Nov 24, 2026 – Dec 5, 2026", "From …" or "Until …"; empty when the sprint has no dates. */
export function sprintDateRange(
  sprint: { startsAt?: number; endsAt?: number },
  t: ReturnType<typeof useT>,
): string {
  const { startsAt, endsAt } = sprint;
  if (startsAt !== undefined && endsAt !== undefined)
    return `${displayDate(startsAt, "")} – ${displayDate(endsAt, "")}`;
  if (startsAt !== undefined) return t("From {p0}", { p0: displayDate(startsAt, "") });
  if (endsAt !== undefined) return t("Until {p0}", { p0: displayDate(endsAt, "") });
  return "";
}
