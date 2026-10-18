import { ServersView, type ServersViewProps } from "./ServersView";
import { ServersTerminalWorkspace } from "./ServersTerminalWorkspace";
import { useContext } from "react";
import { ToolNavigationContext } from "../../../app/shell/ToolNavigation";

export function ServersWorkspaceView(props: ServersViewProps) {
  const navigation = useContext(ToolNavigationContext);
  return (
    <div data-app-servers className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ServersTerminalWorkspace visible={!navigation || navigation.active === "servers"}>
        <ServersView {...props} />
      </ServersTerminalWorkspace>
    </div>
  );
}
