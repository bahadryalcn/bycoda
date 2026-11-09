import { invoke } from "@tauri-apps/api/core";

/** Error kinds the native account module reports; the message never carries token material. */
export type NativeErrorKind =
  | "notConfigured"
  | "signedOut"
  | "sessionExpired"
  | "offline"
  | "unavailable"
  | "keychain"
  | "failed";

export class AccountNativeError extends Error {
  constructor(
    public readonly kind: NativeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AccountNativeError";
  }
}

export type NativeAccountStatus = {
  /** False when this build has no OAuth client; sign-in is hidden. */
  configured: boolean;
  signedIn: boolean;
  apiBaseUrl: string | null;
  environment: "production" | "staging" | null;
};

export type SignInStart = { handle: string; authorizeUrl: string; expiresIn: number };
export type SignInPollStatus = "pending" | "done" | "denied" | "expired" | "cancelled" | "failed";
export type SignInPoll = {
  status: SignInPollStatus;
  error?: { kind: NativeErrorKind; message: string };
};
export type NativeAccessToken = { accessToken: string; expiresAt: number };
export type NativeDeviceInfo = {
  name: string;
  platform: "windows" | "macos" | "linux";
  osVersion: string;
  appVersion: string;
  channel: "stable" | "preview" | "dev";
};

/** The native commands the controller needs; tests and mock mode replace them. */
export type AccountNative = {
  status(): Promise<NativeAccountStatus>;
  signInStart(): Promise<SignInStart>;
  signInPoll(handle: string): Promise<SignInPoll>;
  signInCancel(handle: string): Promise<void>;
  accessToken(): Promise<NativeAccessToken>;
  signOut(): Promise<void>;
  deviceInfo(): Promise<NativeDeviceInfo>;
};

const KINDS: readonly NativeErrorKind[] = [
  "notConfigured",
  "signedOut",
  "sessionExpired",
  "offline",
  "unavailable",
  "keychain",
  "failed",
];

/** Turns a rejected invoke (`{ kind, message }`) into a typed error. */
export function toNativeError(error: unknown): AccountNativeError {
  if (error instanceof AccountNativeError) return error;
  if (typeof error === "object" && error !== null) {
    const { kind, message } = error as { kind?: unknown; message?: unknown };
    if (typeof kind === "string" && (KINDS as readonly string[]).includes(kind)) {
      return new AccountNativeError(kind as NativeErrorKind, String(message ?? ""));
    }
  }
  return new AccountNativeError("failed", typeof error === "string" ? error : "Account failed.");
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toNativeError(error);
  }
}

export const tauriAccountNative: AccountNative = {
  status: () => call("account_status"),
  signInStart: () => call("account_sign_in_start"),
  signInPoll: (handle) => call("account_sign_in_poll", { handle }),
  signInCancel: (handle) => call("account_sign_in_cancel", { handle }),
  accessToken: () => call("account_access_token"),
  signOut: () => call("account_sign_out"),
  deviceInfo: () => call("account_device_info"),
};
