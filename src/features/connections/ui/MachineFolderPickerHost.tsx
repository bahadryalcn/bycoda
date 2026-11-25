import { useEffect, useState } from "react";
import { PICK_MACHINE_FOLDER_EVENT, type MachineFolderRequest } from "../model/machineFolderPick";
import { AddRemoteProjectDialog } from "./AddRemoteProjectDialog";

/**
 * Shows the folder browser of the machine named by `pickFolderOnMachine`. Mount once
 * in the workspace; a newer request cancels the one still open.
 */
export function MachineFolderPickerHost() {
  const [request, setRequest] = useState<MachineFolderRequest>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the window listener for folder-browser requests attached while mounted
  useEffect(() => {
    const show = (event: Event) => {
      const next = (event as CustomEvent<MachineFolderRequest>).detail;
      next.claim();
      setRequest(next);
    };
    window.addEventListener(PICK_MACHINE_FOLDER_EVENT, show);
    return () => window.removeEventListener(PICK_MACHINE_FOLDER_EVENT, show);
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- answers a superseded or unmounted request as cancelled so its caller is released
  useEffect(() => () => request?.settle(undefined), [request]);
  if (!request) return null;
  const close = (key?: string) => {
    request.settle(key);
    setRequest(undefined);
  };
  return (
    <AddRemoteProjectDialog
      key={request.machineId}
      machineId={request.machineId}
      onCancel={() => close()}
      onOpen={close}
    />
  );
}
