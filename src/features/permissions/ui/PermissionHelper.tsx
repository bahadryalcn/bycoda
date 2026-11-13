import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { InlineError } from "../../../shared/ui/InlineError";
import { Surface } from "../../../shared/ui/Surface";
import {
  closePermissionHelper,
  revealPermissionApp,
  type PermissionId,
} from "../../../platform/tauri/systemPermissions";
import { PERMISSION_IDS, permissionInfo } from "../model/permissions";

export function PermissionHelper() {
  useLocale();
  const [error, setError] = useState(false);
  const query = new URLSearchParams(window.location.search).get("permission");
  const id = PERMISSION_IDS.find((id) => id === query) as PermissionId | undefined;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- syncs the document theme class with the OS prefers-color-scheme media query while the helper window is open
  useEffect(() => {
    // This isolated native window follows the OS theme rather than workspace state.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.classList.toggle("dark", media.matches);
      document.documentElement.classList.toggle("theme-light", !media.matches);
      document.documentElement.dataset.theme = media.matches ? "dark" : "light";
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const reveal = () => {
    void revealPermissionApp().catch(() => setError(true));
  };
  return (
    <Surface variant="raised" frame="card" className="m-1 flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Text weight="medium">{t("Add bycoda from Finder")}</Text>
        <Button
          label={t("Close permission helper")}
          onClick={() => void closePermissionHelper().catch(() => setError(true))}
        >
          {t("Close")}
        </Button>
      </div>
      {id && <Text tone="secondary">{permissionInfo(id).label}</Text>}
      <Text tone="secondary">
        {t(
          "Reveal bycoda in Finder, then drag the app from Finder into the system permission list.",
        )}
      </Text>
      <Button onClick={reveal}>{t("Reveal bycoda in Finder")}</Button>
      {error && (
        <InlineError>{t("Could not reveal bycoda or close the helper. Try again.")}</InlineError>
      )}
    </Surface>
  );
}
