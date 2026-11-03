import { useState, useSyncExternalStore } from "react";
import {
  loadSoundsEnabled,
  saveSoundsEnabled,
  subscribeSoundsEnabled,
} from "../../settings/model/sounds";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { AudioLines, VolumeX } from "../../../shared/ui/icons";
import { TransientNotice } from "../../../shared/ui/TransientNotice";

/** Quick access to the same application sound preference used by Settings. */
export function SoundsButton() {
  const t = useT();
  const enabled = useSyncExternalStore(
    subscribeSoundsEnabled,
    loadSoundsEnabled,
    loadSoundsEnabled,
  );
  const [failedValue, setFailedValue] = useState<boolean | null>(null);
  const save = (next: boolean) => {
    setFailedValue(saveSoundsEnabled(next) ? null : next);
  };
  const Icon = enabled ? AudioLines : VolumeX;
  return (
    <>
      <Button
        iconOnly
        label={t("Sounds")}
        variant="ghost"
        motion="none"
        type="button"
        data-workspace-control="sounds"
        data-tauri-drag-region="false"
        aria-pressed={enabled}
        onClick={() => save(!loadSoundsEnabled())}
      >
        <Icon className="icon-sm" />
      </Button>
      {failedValue !== null ? (
        <TransientNotice
          tone="danger"
          message={t("Could not save changes")}
          action={{ label: t("Retry"), onClick: () => save(failedValue) }}
          onDismiss={() => setFailedValue(null)}
        />
      ) : null}
    </>
  );
}
