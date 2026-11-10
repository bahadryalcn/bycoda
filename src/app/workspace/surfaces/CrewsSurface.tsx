import type { BackgroundSessionTarget } from "../../../features/tasks/model/backgroundSession";
import { CrewsPage } from "../../../features/crews/ui/page/CrewsPage";
import { IS_MAC } from "../../../platform/tauri/platform";
import { OverlayNav } from "../../shell/TitleBar";
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
  return (
    <CrewsPage
      {...page}
      chromeInset={!besideRail ? true : compactRail ? "compact" : false}
      leading={
        besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
      }
      trailing={IS_MAC ? null : <WindowControls />}
    />
  );
}
