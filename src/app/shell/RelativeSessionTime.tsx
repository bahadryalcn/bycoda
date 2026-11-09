import { formatRelative } from "../../features/sessions/model/recentSessions";
import { useLocale } from "../../shared/i18n";
import { useMinuteNow } from "../../shared/hooks/useMinuteNow";

export function RelativeSessionTime({ at }: { at: number }) {
  useLocale();
  const now = useMinuteNow();
  return <span>{formatRelative(at, now)}</span>;
}
