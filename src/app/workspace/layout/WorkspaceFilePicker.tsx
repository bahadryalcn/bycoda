import {
  memo,
  type ComponentProps,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { useHeldValue } from "../helpers/stableProps";
import type { Session } from "../../../features/sessions/model/session";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { LayoutPreset } from "../../../features/workspace/model/layoutPresets";
import { FilePicker, LAYOUT_ACTION_PREFIX } from "../../../features/files/ui/FilePicker";
import {
  canStopHarnessBackgroundWork,
  stopHarnessBackgroundWork,
} from "../../../integrations/harness";
import { sessionHasBackgroundWork } from "../../../features/sessions/model/backgroundStop";
import { reconnectRemoteMachine } from "../../../features/connections/model/remoteReconnect";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import { toggleNotesPanel } from "../../../features/notes/notesPanel";
import type { WorkspaceActions } from "../input/useWorkspaceActions";

type FilePickerProps = ComponentProps<typeof FilePicker>;

export interface WorkspaceFilePickerProps {
  filePickerOpen: boolean;
  filePickerResetToken: number;
  filePickerInitialQuery: string;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  filesCwd: string;
  openFilePaths: FilePickerProps["openPaths"];
  active: Session | undefined;
  activeTab: WorkspaceTab | undefined;
  onOpenFile: FilePickerProps["onOpenFile"];
  onArrangeActiveTab: (preset: LayoutPreset) => void;
  actions: MutableRefObject<WorkspaceActions>;
}

function WorkspaceFilePickerComponent({
  filePickerOpen,
  filePickerResetToken,
  filePickerInitialQuery,
  setFilePickerOpen,
  filesCwd,
  openFilePaths,
  active,
  activeTab,
  onOpenFile,
  onArrangeActiveTab,
  actions,
}: WorkspaceFilePickerProps) {
  return filePickerOpen ? (
    <FilePicker
      key={filePickerResetToken}
      open
      cwd={filesCwd}
      openPaths={openFilePaths}
      initialQuery={filePickerInitialQuery}
      stopBackgroundWork={
        !!active && canStopHarnessBackgroundWork(active.harness) && sessionHasBackgroundWork(active)
      }
      arrangeLayout={Boolean(activeTab)}
      onOpenFile={onOpenFile}
      onRunAction={(id) => {
        const layoutPreset = id.startsWith(LAYOUT_ACTION_PREFIX)
          ? (id.slice(LAYOUT_ACTION_PREFIX.length) as LayoutPreset)
          : null;
        if (layoutPreset) onArrangeActiveTab(layoutPreset);
        else if (id === "reload") actions.current.onReload();
        else if (id === "stop-background" && active) {
          void stopHarnessBackgroundWork(active.harness, active.id).catch(console.error);
        } else if (id === "reconnect-remote") {
          const remote = remoteProjectFor(filesCwd);
          if (remote)
            void reconnectRemoteMachine(remote.environmentId, {
              signIn: true,
            });
        } else if (id === "toggle-notes" && loadNotesEnabled()) toggleNotesPanel();
      }}
      onClose={() => setFilePickerOpen(false)}
    />
  ) : null;
}

const MemoFilePicker = memo(WorkspaceFilePickerComponent);

/** Closed, the picker renders nothing: it keeps the values it last opened with so
 * the memo skips the workspace's renders until it opens again. */
export function WorkspaceFilePicker(props: WorkspaceFilePickerProps) {
  const held = useHeldValue(props, props.filePickerOpen);
  return (
    <MemoFilePicker
      {...useStableHandlers(props.filePickerOpen ? props : { ...held, filePickerOpen: false })}
    />
  );
}
