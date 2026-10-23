import { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import {
  useSessionsSelector,
  isTextOnlyChange,
} from "../../../features/sessions/model/sessionsStore";
import { useLocale } from "../../../shared/i18n";
import { NavigationBoundary } from "../../shell/NavigationBoundary";
import { SearchView } from "../surfaces/lazySurfaces";
import { type ComponentProps, useMemo } from "react";

/** Search adopts accumulated streamed text with the next structural update. */
export function LiveSearchView({
  lockSnapshot,
  ...props
}: Omit<ComponentProps<typeof SearchView>, "sessions"> & {
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
}) {
  useLocale();
  const live = useSessionsSelector((sessions) => sessions, isTextOnlyChange);
  const sessions = useMemo(
    () =>
      live.filter((session) => !session.inboxAsk && !isProjectLockedIn(lockSnapshot, session.cwd)),
    [live, lockSnapshot],
  );
  return (
    <NavigationBoundary name="Search" onBack={props.onClose}>
      <SearchView {...props} sessions={sessions} />
    </NavigationBoundary>
  );
}
