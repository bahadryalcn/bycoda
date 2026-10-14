import { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { useLiveSessions } from "../../../features/sessions/model/sessionsStore";
import { useLocale } from "../../../shared/i18n";
import { SearchView } from "../surfaces/lazySurfaces";
import { type ComponentProps, useMemo } from "react";

/** Search reads message text, so it subscribes to the live sessions itself. */
export function LiveSearchView({
  lockSnapshot,
  ...props
}: Omit<ComponentProps<typeof SearchView>, "sessions"> & {
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
}) {
  useLocale();
  const live = useLiveSessions();
  const sessions = useMemo(
    () =>
      live.filter((session) => !session.inboxAsk && !isProjectLockedIn(lockSnapshot, session.cwd)),
    [live, lockSnapshot],
  );
  return <SearchView {...props} sessions={sessions} />;
}
