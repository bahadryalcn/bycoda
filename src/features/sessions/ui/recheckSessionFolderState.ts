import {
  hydrateSessionOrganization,
  unresolvedSessionOrganizationGestures,
} from "../model/sessionOrganizationStore";
import { listPinSagas } from "../model/sessionPinSaga";
import { t } from "../../../shared/i18n";

/** Resolves to why a folder change is still blocked, or null once the organization state is refreshed. */
export async function recheckSessionFolderState(): Promise<string | null> {
  const pending = await unresolvedSessionOrganizationGestures();
  if (pending.length)
    return t("Folder change outcome is unknown: {p0}", { p0: pending[0].operationId });
  const remaining = (await listPinSagas()).filter(
    (entry) => entry.state !== "applied" && entry.state !== "accepted",
  );
  if (remaining.length)
    return t("Pin change needs review in the sidebar: {p0}", { p0: remaining[0].id });
  await hydrateSessionOrganization();
  return null;
}
