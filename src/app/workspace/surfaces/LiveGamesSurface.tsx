import { useContext } from "react";
import { LiveGamesPage } from "../../../features/live-games";
import { IS_MAC } from "../../../platform/tauri/platform";
import { OverlayNav } from "../../shell/TitleBar";
import { ToolNavigation, ToolNavigationContext } from "../../shell/ToolNavigation";
import { WindowControls } from "../../shell/WindowControls";

export function LiveGamesSurface({
  besideRail,
  compactRail,
  onClose,
  onToggleSidebar,
}: {
  besideRail: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
}) {
  const grouped = !!useContext(ToolNavigationContext)?.active;
  return (
    <LiveGamesPage
      chromeInset={!besideRail ? true : compactRail ? "compact" : false}
      leading={besideRail ? undefined : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
      trailing={IS_MAC ? undefined : <WindowControls />}
      navigation={grouped ? <ToolNavigation /> : undefined}
    />
  );
}
