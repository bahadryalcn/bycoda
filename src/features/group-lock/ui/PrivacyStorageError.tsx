import { t } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { retryGroupLockStorage } from "../model/groupLock";

/** Recovery only rereads persisted protection. It never resets or unlocks it. */
export function PrivacyStorageError() {
  return (
    <Alert tone="danger">
      {t(
        "Privacy settings are unavailable. Your workspace stays concealed until they can be read.",
      )}
      <Button onClick={() => retryGroupLockStorage()}>{t("Retry")}</Button>
    </Alert>
  );
}
