import { useContext } from "react";
import type { BackgroundSessionTarget } from "../../../features/tasks/model/backgroundSession";
import { CrewsPage } from "../../../features/crews/ui/page/CrewsPage";
import { IS_MAC } from "../../../platform/tauri/platform";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { OverlayNav } from "../../shell/TitleBar";
import { ToolNavigation, ToolNavigationContext } from "../../shell/ToolNavigation";
import { WindowControls } from "../../shell/WindowControls";

export type CrewsSurfaceProps = {
  cwd: string;
  onClose: () => void;
  onToggleSidebar?: () => void;
  besideRail?: boolean;
  compactRail?: boolean;
  onOpenSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
};

/** The app's window chrome around the Crews page, as the Social view does for its header. */
export function CrewsSurface({
  besideRail,
  compactRail,
  onClose,
  onToggleSidebar,
  ...page
}: CrewsSurfaceProps) {
  const chromeInset = !besideRail ? true : compactRail ? "compact" : false;
  const leading = besideRail ? null : (
    <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
  );
  const trailing = IS_MAC ? null : <WindowControls />;
  // With the grouped tool navigation the window chrome carries the tool tabs, as in the other
  // tools; the page keeps its own title bar below them.
  if (useContext(ToolNavigationContext)?.active)
    return (
      <>
        <PaneHeader dragRegion chromeInset={chromeInset} leading={leading} trailing={trailing}>
          <ToolNavigation />
        </PaneHeader>
        <CrewsPage {...page} chromeInset={false} />
      </>
    );
  return <CrewsPage {...page} chromeInset={chromeInset} leading={leading} trailing={trailing} />;
}
