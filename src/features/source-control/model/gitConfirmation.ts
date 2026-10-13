import { ask } from "@tauri-apps/plugin-dialog";
import { appName } from "../../../shared/lib/appName";
import { basename, type GitChangedFile } from "../../../platform/tauri/fs";

export function confirmNative(message: string, okLabel?: string): Promise<boolean> {
  return ask(message, {
    title: appName(),
    kind: "warning",
    ...(okLabel ? { okLabel } : {}),
  });
}

export function confirmDiscardFile(file: GitChangedFile): Promise<boolean> {
  const name = basename(file.relative);
  const untracked = file.status === "untracked";
  return confirmNative(
    untracked
      ? `Delete untracked file ${name}?`
      : `Discard changes in ${name}? This cannot be undone.`,
    untracked ? "Delete" : "Discard",
  );
}
