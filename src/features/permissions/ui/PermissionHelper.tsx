import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { InlineError } from "../../../shared/ui/InlineError";
import { Surface } from "../../../shared/ui/Surface";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  closePermissionHelper,
  revealPermissionApp,
  type PermissionId,
} from "../../../platform/tauri/systemPermissions";
import { PERMISSION_IDS, permissionInfo } from "../model/permissions";

/**
 * The card docked under System Settings. Its native window has a fixed
 * height, so it keeps three rows: title, one line (the step or the error) and
 * the reveal action.
 */
export function PermissionHelper() {
  useLocale();
  const [error, setError] = useState(false);
  const query = new URLSearchParams(window.location.search).get("permission");
  const id = PERMISSION_IDS.find((id) => id === query) as PermissionId | undefined;
  const reveal = () => {
    setError(false);
    void revealPermissionApp().catch(() => setError(true));
  };
  return (
    <Surface variant="card" frame="card" className="m-1 flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <Text weight="medium" truncate>
          {id
            ? t("Add {p0} to {p1}", {
                p0: PRODUCT_IDENTITY.displayName,
                p1: permissionInfo(id).label,
              })
            : t("Add bycoda from Finder")}
        </Text>
        <Button
          variant="ghost"
          onClick={() => void closePermissionHelper().catch(() => setError(true))}
        >
          {t("Close")}
        </Button>
      </div>
      {error ? (
        <InlineError>{t("Could not reveal bycoda or close the helper. Try again.")}</InlineError>
      ) : (
        <Text tone="secondary">
          {t(
            "Reveal bycoda in Finder, then drag the app from Finder into the system permission list.",
          )}
        </Text>
      )}
      <Button variant="primary" onClick={reveal}>
        {t("Reveal bycoda in Finder")}
      </Button>
    </Surface>
  );
}
