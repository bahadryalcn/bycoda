import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import { crewManagedSession, isCrewManagedRefusal } from "../../../features/crews/public/managed";

/**
 * True, after telling the owner, when a crew manages this conversation. Stop, archive and delete
 * are Crews actions; the session itself only reads. The Host refuses the same operations.
 */
export function refuseCrewManagedSession(sessionId: string | undefined): boolean {
  if (!crewManagedSession(sessionId)) return false;
  showCrewManagedNotice();
  return true;
}

function showCrewManagedNotice() {
  toast.show({
    tone: "warning",
    message: `${t("Managed from Crews")}. ${t("Open Crews to stop, archive or delete this conversation.")}`,
  });
}

/** True after showing the same notice when the Host itself refused (`crew_managed_session`). */
export function reportCrewManagedRefusal(error: unknown): boolean {
  if (!isCrewManagedRefusal(error)) return false;
  showCrewManagedNotice();
  return true;
}
