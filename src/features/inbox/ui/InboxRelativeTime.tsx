import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { getLocale, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../model/githubTasks";

/**
 * Relative age of an Inbox timestamp ("5 minutes ago"). The label reads the shared minute clock
 * itself, so the memoized card, row or timeline stop around it does not re-render for each tick,
 * and the clock pauses while the window is hidden. Wording and locale stay those of the Inbox
 * formatter, so this is the only place that re-reads the time.
 */
export function InboxRelativeTime({ at }: { at: string }) {
  useLocale();
  const now = useMinuteNow();
  // The shared formatter defaults its locale to the system locale, not the app language.
  return <>{formatRelativeTime(at, now, getLocale())}</>;
}

/** Whether `at` has a label to show; the same validity check the formatter applies. */
export function hasInboxRelativeTime(at: string | undefined): at is string {
  return at != null && Number.isFinite(Date.parse(at));
}
