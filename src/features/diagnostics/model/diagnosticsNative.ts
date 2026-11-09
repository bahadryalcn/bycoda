import { invoke } from "@tauri-apps/api/core";

export type NativeLogSection = { name: string; text: string; truncated: boolean };
export type NativeCrash = {
  message: string;
  location: string | null;
  thread: string | null;
  backtrace: string;
  occurredAt: string;
  appVersion: string;
};
export type NativeLogs = {
  sections: NativeLogSection[];
  homeDir: string | null;
  crash: NativeCrash | null;
  /** The marker the Host process left behind; same shape as `crash`. */
  hostCrash: NativeCrash | null;
};

/** The native commands (`diagnostics_collect_logs`, `diagnostics_clear_crash`); tests and browser dev replace or lack them. */
export type DiagnosticsNative = {
  /** False outside the desktop shell: no logs, no crash marker. */
  available: boolean;
  collectLogs(): Promise<NativeLogs>;
  clearCrash(): Promise<void>;
  /** Gzip + base64 in Rust, for webviews without `CompressionStream`. */
  gzipBase64?(text: string): Promise<string>;
};

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const NONE: NativeLogs = { sections: [], homeDir: null, crash: null, hostCrash: null };

export const tauriDiagnosticsNative: DiagnosticsNative = {
  get available() {
    return inTauri();
  },
  collectLogs: async () => {
    if (!inTauri()) return NONE;
    const logs = await invoke<NativeLogs>("diagnostics_collect_logs");
    return { ...logs, hostCrash: logs.hostCrash ?? null }; // -- an older native build has no Host marker.
  },
  gzipBase64: (text) => invoke<string>("diagnostics_gzip_base64", { text }),
  clearCrash: async () => {
    if (inTauri()) await invoke<void>("diagnostics_clear_crash");
  },
};
