import { useState, useSyncExternalStore } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import {
  loadSoundsEnabled,
  saveSoundsEnabled,
  subscribeSoundsEnabled,
} from "../../settings/model/sounds";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { AudioLines, VolumeX } from "../../../shared/ui/icons";
import { TransientNotice } from "../../../shared/ui/TransientNotice";

/** The application sound preference used by Settings, with a retry notice for failed saves. */
export function useSoundsToggle() {
  const t = useT();
  const enabled = useSyncExternalStore(
    subscribeSoundsEnabled,
    loadSoundsEnabled,
    loadSoundsEnabled,
  );
  const [failedValue, setFailedValue] = useState<boolean | null>(null);
  const save = useStableCallback((next: boolean) => {
    setFailedValue(saveSoundsEnabled(next) ? null : next);
  });
  // Event-only: the guard sees loadSoundsEnabled behind a deferred hook, not a render read.
  const toggle = useStableCallback(() => save(!loadSoundsEnabled()));
  const notice =
    failedValue !== null ? (
      <TransientNotice
        tone="danger"
        message={t("Could not save changes")}
        action={{ label: t("Retry"), onClick: () => save(failedValue) }}
        onDismiss={() => setFailedValue(null)}
      />
    ) : null;
  return { enabled, toggle, notice };
}

/** Quick access to the same application sound preference used by Settings. */
export function SoundsButton() {
  const t = useT();
  const { enabled, toggle, notice } = useSoundsToggle();
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
        onClick={toggle}
      >
        <Icon className="icon-sm" />
      </Button>
      {notice}
    </>
  );
}
