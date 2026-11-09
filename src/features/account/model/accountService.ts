import { openExternal } from "../../../platform/tauri/openExternal";
import { isAccountMockMode } from "./accountClient";
import { createAccountController, type AccountController } from "./accountController";
import { tauriAccountNative, type AccountNative } from "./accountNative";

let controller: AccountController | null = null;
let nativeInUse: AccountNative = tauriAccountNative;

/** Native commands, or the in-memory runtime loaded on first use in mock mode. */
function mockNative(): { native: AccountNative; fetchImpl: typeof fetch } {
  let runtime: ReturnType<typeof loadMock> | null = null;
  const loadMock = () => import("./accountMock").then((m) => m.createMockAccountRuntime());
  const load = () => (runtime ??= loadMock());
  return {
    native: {
      status: async () => (await load()).native.status(),
      signInStart: async () => (await load()).native.signInStart(),
      signInPoll: async (handle) => (await load()).native.signInPoll(handle),
      signInCancel: async (handle) => (await load()).native.signInCancel(handle),
      accessToken: async () => (await load()).native.accessToken(),
      signOut: async () => (await load()).native.signOut(),
      deviceInfo: async () => (await load()).native.deviceInfo(),
    },
    fetchImpl: async (input, init) => (await load()).fetchImpl(input, init),
  };
}

/** The one account controller of this window. */
export function accountController(): AccountController {
  if (controller) return controller;
  if (isAccountMockMode()) {
    const mock = mockNative();
    nativeInUse = mock.native;
    controller = createAccountController({
      native: mock.native,
      fetchImpl: mock.fetchImpl,
      openExternal: async () => undefined,
      pollMs: 50,
    });
  } else {
    controller = createAccountController({ native: tauriAccountNative, openExternal });
  }
  return controller;
}

let started: Promise<void> | null = null;
let listening = false;

/** Starts the account once per window; calling it again returns the same promise. */
export function startAccount(): Promise<void> {
  if (!listening && typeof window !== "undefined") {
    listening = true;
    const revalidate = () => {
      accountController()
        .revalidate()
        .catch(() => undefined); // -- failures are classified inside; the view stays as it was.
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", revalidate);
  }
  started ??= accountController()
    .start()
    .catch(() => undefined); // -- a failed start leaves the app signed out, which is fully usable.
  return started;
}

/** Re-runs the start-up check, for the retry button after an offline start. */
export function restartAccount(): Promise<void> {
  started = null;
  return startAccount();
}

/** Version, platform, OS and channel from the same native source the anonymous statistics use. */
export function accountDeviceInfo() {
  accountController(); // -- picks the real or the mock native before the lookup.
  return nativeInUse.deviceInfo();
}

/** What diagnostic reports need to know about the account: whether it exists, the route, the e-mail to redact. */
export function accountIdentity(): { available: boolean; signedIn: boolean; email: string | null } {
  const state = accountController().getState();
  return {
    available: state.phase !== "unavailable",
    signedIn: state.phase === "signed-in",
    email: state.phase === "signed-in" ? state.context.user.email : null,
  };
}
