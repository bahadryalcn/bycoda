import { Button } from "../../shared/ui/Button";
import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import { RefreshCw } from "../../shared/ui/icons";
import { FullscreenButton } from "./FullscreenButton";
import { SoundsButton } from "../../features/notifications/ui/SoundsButton";

export const WORKSPACE_REFRESH_EVENT = "bycoda:refresh-workspace-view";

/** The Usage glyph lives with the shared icons; this re-export keeps existing imports working. */
export { UsageIcon } from "../../shared/ui/icons";

export function WorkspaceControls({ canRefresh = true }: { canRefresh?: boolean }) {
  const t = useT();
  return (
    <Text
      as="nav"
      size="inherit"
      tone="secondary"
      aria-label={t("Workspace controls")}
      className="ml-auto flex shrink-0 items-center justify-end gap-1"
    >
      <Button
        iconOnly
        label={t("Refresh current view")}
        variant="ghost"
        motion="none"
        type="button"
        disabled={!canRefresh}
        onClick={() => window.dispatchEvent(new Event(WORKSPACE_REFRESH_EVENT))}
      >
        <RefreshCw className="icon-sm" />
      </Button>
      <SoundsButton />
      <FullscreenButton />
    </Text>
  );
}
