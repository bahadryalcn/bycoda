import { QueryProvider } from "./app/QueryProvider";
// First: later modules read storage while they load.
import "./app/model/legacyStorageMigration";
import { readToolWindow } from "./app/model/toolWindows";
import { loadWindowSurface, readHostToolsWindow } from "./app/model/hostToolsWindow";
import { t, languageReady } from "./shared/i18n";
import { PRODUCT_IDENTITY } from "./shared/lib/productIdentity";
import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { restoreTransferredDrafts } from "./app/model/windowTransfer";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { activateWindowAppearance, initAppearance } from "./features/settings/model/appearance";
import { initSounds } from "./features/settings/model/sounds";
import {
  abortQuit,
  askQuitConfirmation,
  commitQuit,
  loadBootWorkspace,
  reportQuitPoll,
} from "./app/model/appLifecycle";
import { hydrateComposerDrafts } from "./features/sessions/data/composerDraftStore";
import { homeDir, pathEnvironment } from "./platform/tauri/fs";
import { setHomeDir, setPathEnvironment } from "./shared/lib/paths";
import { consumeInstalledUpdate } from "./app/model/updateNotice";
import { initializeProviderBinaryPaths } from "./features/providers/model/providerBinaryPaths";
// Lets file commands reach a connected machine for `remote://` paths.
import "./features/connections/model/remoteCommands";
import "./features/connections/model/remoteGitWatch";
import "./styles/index.css";
import { installNativeContextMenuGuard } from "./shared/lib/nativeContextMenu";

const removeContextMenuGuard = installNativeContextMenuGuard();
if (import.meta.hot) import.meta.hot.dispose(removeContextMenuGuard);
import { bootstrap } from "./app/model/bootstrap";
import { BootFailure } from "./app/shell/BootFailure";
import { RecoveryBoundary } from "./shared/ui/RecoveryBoundary";
import { Button } from "./shared/ui/Button";
import { BootGate } from "./app/shell/BootGate";
import { NoteDraftRecoveryNotice } from "./features/notes/ui/NoteDraftRecoveryNotice";
import { PrivacyLaunchGate } from "./features/group-lock/ui/PrivacyLaunchGate";

import { startPerformanceSpan, recordPerformanceEvent } from "./shared/lib/performanceTrace";
import { initPerformanceTracing } from "./shared/lib/performanceTraceSettings";

// Opt in with VITE_REACT_SCAN=1 when starting Vite. The outer DEV guard lets
// production builds remove both this branch and the diagnostic dependency.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "1") {
  void import("react-scan")
    .then(({ scan }) => scan({ enabled: true }))
    .catch((error: unknown) => console.warn("[bycoda] React Scan failed to load", error));
}

// Must run before the startup span so an enabled trace captures this boot.
initPerformanceTracing();
performance.mark("bycoda:bootstrap");
const finishStartup = startPerformanceSpan("startup");
// Resolve the role before starting imports: tool windows never evaluate App.
// Loading the chosen surface still overlaps the local boot IPC.
const hostToolsWindow = readHostToolsWindow();
const surfaceLoaded = loadWindowSurface(
  hostToolsWindow,
  async () => ({ kind: "workspace" as const, App: (await import("./app/App")).default }),
  async () => ({
    kind: "host-tools" as const,
    HostToolsWindow: (await import("./features/host-tools/HostToolsWindow")).default,
  }),
);

initAppearance();
initSounds();
// Prime the real home directory before the first render so every `~/` file
// reference resolves consistently. The IPC call is local and failures remain
// best-effort, falling back to inference from a session's cwd.
const homeDirPrimed = Promise.allSettled([
  homeDir().then(setHomeDir),
  pathEnvironment().then(setPathEnvironment),
]);
void initializeProviderBinaryPaths().catch(() => undefined);

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.dismissed === "1") return;
  splash.dataset.dismissed = "1";
  const fade = () => {
    activateWindowAppearance();
    splash.classList.add("boot-splash-out");
    window.setTimeout(() => {
      splash.remove();
      performance.mark("bycoda:ui-ready");
      performance.measure("bycoda:navigation-to-ui", {
        start: 0,
        end: "bycoda:ui-ready",
      });
    }, 180);
  };
  // useLayoutEffect runs before paint. Two frames later the app is on
  // screen, so the fade reveals UI instead of the desktop blur.
  requestAnimationFrame(() => {
    requestAnimationFrame(fade);
  });
}

void listen<number>("quit_poll", (event) => {
  void reportQuitPoll(event.payload);
});
// Scoped to this window on purpose: a global `listen` is registered as `Any`,
// which Tauri matches for every event regardless of the emitter's target, so
// one dialog would become one per window.
void getCurrentWebviewWindow().listen<{ id: number; inFlight: number }>("quit_confirm", (event) => {
  void askQuitConfirmation(event.payload.id, event.payload.inFlight);
});
void listen<number>("quit_commit", (event) => {
  void commitQuit(event.payload);
});
void listen("quit_aborted", () => {
  abortQuit();
});

const appRoot = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
// Show a bounded, safe shell while workspace and durable drafts hydrate.
// Composer remains unmounted until its draft cache is ready, preventing a
// blank draft write from racing the saved draft read.
appRoot.render(
  <BootGate transferred={false} onMounted={dismissBootSplash}>
    <div
      role="status"
      aria-live="polite"
      style={{
        height: "100vh",
        display: "grid",
        placeContent: "center",
        gap: 12,
        textAlign: "center",
        background: "var(--ui-startup-surface)",
        color: "var(--ui-startup-text)",
      }}
    >
      <img
        src="/brand/bycoda/mark-tea-red-loading.svg"
        alt=""
        aria-hidden="true"
        width={72}
        height={72}
        style={{ inlineSize: 72, blockSize: 72, objectFit: "contain", justifySelf: "center" }}
      />
      <strong>{PRODUCT_IDENTITY.displayName}</strong>
      <span>{t("Restoring your workspace and saved drafts...")}</span>
      <Button motion="none" onClick={() => window.location.reload()}>
        {t("Retry loading")}
      </Button>
    </div>
  </BootGate>,
);
performance.mark("bycoda:shell-ready");
recordPerformanceEvent("startup", { items: 1 });

void bootstrap(
  () =>
    Promise.all([
      homeDirPrimed,
      // Provider discovery is best-effort and may finish after UI hydration.
      Promise.resolve(),
      hostToolsWindow
        ? Promise.resolve({ windowTransfer: null, resumed: null, history: [], historyCwd: null })
        : loadBootWorkspace(),
      // Saved drafts are in the cache before the first composer mounts.
      hydrateComposerDrafts(),
      surfaceLoaded,
      languageReady,
    ]),
  ([, , { windowTransfer, resumed, history, historyCwd }, , surface]) => {
    performance.mark("bycoda:workspace-ready");
    performance.mark("bycoda:input-ready");
    finishStartup();
    const toolWindow = readToolWindow();
    const installedUpdate =
      windowTransfer || toolWindow || hostToolsWindow ? null : consumeInstalledUpdate();
    if (windowTransfer) restoreTransferredDrafts(windowTransfer);
    appRoot.render(
      <React.StrictMode>
        <RecoveryBoundary fullScreen>
          <QueryProvider>
            <BootGate transferred={!!windowTransfer} onMounted={dismissBootSplash}>
              {(transferReady) => (
                <PrivacyLaunchGate>
                  {surface.kind === "host-tools" && hostToolsWindow ? (
                    <surface.HostToolsWindow {...hostToolsWindow} />
                  ) : (
                    <>
                      {surface.kind === "workspace" ? (
                        <surface.App
                          windowTransfer={windowTransfer}
                          toolWindow={toolWindow}
                          windowTransferPending={!transferReady}
                          resumed={resumed}
                          installedUpdate={installedUpdate}
                          history={history}
                          historyCwd={historyCwd}
                        />
                      ) : null}
                    </>
                  )}
                  <NoteDraftRecoveryNotice />
                </PrivacyLaunchGate>
              )}
            </BootGate>
          </QueryProvider>
        </RecoveryBoundary>
      </React.StrictMode>,
    );
  },
  (error) => {
    document.getElementById("boot-splash")?.remove();
    appRoot.render(<BootFailure error={error} onRetry={() => window.location.reload()} />);
  },
);
