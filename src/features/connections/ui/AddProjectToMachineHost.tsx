import { useEffect, useRef, useState } from "react";
import {
  ADD_PROJECT_TO_MACHINE_EVENT,
  type AddProjectToMachineRequest,
} from "../model/addProjectToMachine";
import { AddProjectToMachineDialog } from "./AddProjectToMachineDialog";

/**
 * Shows the dialog for `addProjectToMachine`. Mount once in the workspace; a newer
 * request cancels the one still open.
 */
export function AddProjectToMachineHost() {
  const [shown, setShown] = useState<{ request: AddProjectToMachineRequest; key: number }>();
  const nextKey = useRef(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the window listener for add-to-machine requests attached while mounted
  useEffect(() => {
    const show = (event: Event) => {
      const next = (event as CustomEvent<AddProjectToMachineRequest>).detail;
      next.claim();
      setShown({ request: next, key: nextKey.current++ });
    };
    window.addEventListener(ADD_PROJECT_TO_MACHINE_EVENT, show);
    return () => window.removeEventListener(ADD_PROJECT_TO_MACHINE_EVENT, show);
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- answers a superseded or unmounted request as cancelled so its caller is released
  useEffect(() => () => shown?.request.settle(undefined), [shown]);
  if (!shown) return null;
  const close = (path?: string) => {
    shown.request.settle(path);
    setShown(undefined);
  };
  return <AddProjectToMachineDialog key={shown.key} request={shown.request} onDone={close} />;
}
