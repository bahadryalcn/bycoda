import { pickFolders } from "../../../platform/tauri/fs";
import { looksLikeProject } from "../../projects/public/recents";

/** Where a folder must live: this computer, or one registered machine. */
export type MachineFolderTarget = { kind: "local" } | { kind: "remote"; machineId: string };

/** Window event carrying a {@link MachineFolderRequest} to the mounted browser host. */
export const PICK_MACHINE_FOLDER_EVENT = "bycoda:pick-machine-folder";

export interface MachineFolderRequest {
  machineId: string;
  /** Called by the host that will show the browser, before the event returns. */
  claim: () => void;
  /** Answers once with the registered remote project key, or undefined on cancel. */
  settle: (key: string | undefined) => void;
}

/**
 * Picks a folder on exactly the given machine and returns a verified project path:
 * a local path from the OS picker, or a remote project key the Host registered
 * (`projects.open`). Resolves undefined when the user cancels, so a draft stays as
 * it was; rejects when no browser could be shown. Never guesses a path from a name.
 */
export function pickFolderOnMachine(target: MachineFolderTarget): Promise<string | undefined> {
  if (target.kind === "local") return pickLocalFolder();
  return new Promise((resolve, reject) => {
    let claimed = false;
    let settled = false;
    const request: MachineFolderRequest = {
      machineId: target.machineId,
      claim: () => {
        claimed = true;
      },
      settle: (key) => {
        if (settled) return;
        settled = true;
        resolve(key);
      },
    };
    window.dispatchEvent(new CustomEvent(PICK_MACHINE_FOLDER_EVENT, { detail: request }));
    if (!claimed) {
      settled = true;
      reject(new Error("The folder browser is not available."));
    }
  });
}

async function pickLocalFolder(): Promise<string | undefined> {
  const [path] = await pickFolders(undefined, false);
  return path && looksLikeProject(path) ? path : undefined;
}
