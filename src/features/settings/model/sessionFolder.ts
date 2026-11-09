import { invoke } from "@tauri-apps/api/core";

/** Where sessions without a project run (src-tauri session_folder.rs). */
export type SessionFolder = {
  /** The saved choice; absent means the home folder. */
  chosen: string | null;
  home: string | null;
};

export const loadSessionFolder = () => invoke<SessionFolder>("session_folder");

/** `null` goes back to the home folder. The native side validates and creates the folder. */
export const saveSessionFolder = (folder: string | null) =>
  invoke<void>("set_session_folder", { folder });
