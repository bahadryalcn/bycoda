import type { SocialHeaderProps, SocialViewProps } from "../../../features/social/ui/SocialView";
import { IS_MAC } from "../../../platform/tauri/platform";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { ToolHeader } from "../../shell/ToolNavigation";
import { OverlayNav } from "../../shell/TitleBar";
import { WindowControls } from "../../shell/WindowControls";

/** The app's window chrome for Social's header row, passed to the feature's header slot. */
function SocialHeader({
  besideRail,
  compactRail,
  onClose,
  onToggleSidebar,
  children,
}: SocialHeaderProps) {
  return (
    <PaneHeader
      dragRegion
      chromeInset={!besideRail ? true : compactRail ? "compact" : false}
      className="select-none"
      leading={
        besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
      }
      trailing={IS_MAC ? null : <WindowControls />}
    >
      <ToolHeader>{children}</ToolHeader>
    </PaneHeader>
  );
}

/** Social's surface mount: loads the feature lazily and supplies the app's header chrome. */
export const SocialView = lazySurface<Omit<SocialViewProps, "header">>(async () => {
  const module = await import("../../../features/social/ui/SocialView");
  return {
    default: (props: Omit<SocialViewProps, "header">) => (
      <module.SocialView {...props} header={SocialHeader} />
    ),
  };
});
