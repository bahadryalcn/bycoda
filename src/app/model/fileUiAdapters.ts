import { configureFolderPicker } from "../../platform/tauri/folderPicker";
import { setRemoteMachineResolver } from "../../platform/tauri/fs";

setRemoteMachineResolver(async (environmentId) => {
  const { remoteMachineFor } = await import("../../features/connections/model/connections");
  return remoteMachineFor(environmentId);
});

const release = configureFolderPicker(async (options) => {
  const { openFolderPicker } = await import("../../features/projects/ui/openFolderPicker");
  return openFolderPicker(options);
});
if (import.meta.hot) import.meta.hot.dispose(release);
