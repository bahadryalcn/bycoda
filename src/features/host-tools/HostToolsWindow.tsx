import type { HostToolsWindow as HostToolsWindowProps } from "../../app/model/hostToolsWindow";
import { SessionHostTools } from "./SessionHostTools";
import { ToolsWorkspace } from "./ToolsWorkspace";

export default function HostToolsWindow(props: HostToolsWindowProps) {
  return (
    <div className="host-tools-window font-sans text-content">
      <ToolsWorkspace>
        <SessionHostTools {...props} hidePresentation />
      </ToolsWorkspace>
    </div>
  );
}
