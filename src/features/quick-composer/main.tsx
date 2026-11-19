import { bootSecondaryWindowAppearance } from "../settings/model/secondaryWindowAppearance";
import { QueryProvider } from "../../app/QueryProvider";
import "../../app/model/fileUiAdapters";
import { startRendererModelRoutingAfterPaint } from "../model-routing/public/rendererBootstrap";
import React from "react";
import { languageReady } from "../../shared/i18n";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { QuickGitPopup } from "./ui/QuickGitPopup";
import { QuickComposer } from "./ui/QuickComposer";
import { PrivacyLaunchGate } from "../group-lock/ui/PrivacyLaunchGate";
import { getGroupLockView } from "../group-lock/model/groupLock";
import "../../styles/index.css";
import { installNativeContextMenuGuard } from "../../shared/lib/nativeContextMenu";
import { installNativeProjectionCheckpointReceiver } from "../sessions/data/nativeProjectionCheckpoint";
import { quickComposerClosure } from "./model/quickComposerClosure";

const removeContextMenuGuard = installNativeContextMenuGuard();
if (import.meta.hot) import.meta.hot.dispose(removeContextMenuGuard);
const nativeProjectionReceiver = installNativeProjectionCheckpointReceiver(
  new URLSearchParams(window.location.search).get("popup") === "git"
    ? {}
    : { quickBegin: (options) => quickComposerClosure.begin(options) },
);
void nativeProjectionReceiver.ready.catch(() => undefined);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void nativeProjectionReceiver.dispose();
  });

// Every show also reloads the theme after a hidden window resumes.
const applyAppearance = bootSecondaryWindowAppearance();
const onShown = () => {
  applyAppearance();
  startRendererModelRoutingAfterPaint();
};

void languageReady.then(async () => {
  if (getGroupLockView().settings.startInPrivacyMode) {
    // The panel normally starts at 128px; leave room for privacy and password controls.
    await invoke("quick_composer_fit", { height: 440 }).catch(() => undefined);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryProvider>
        <PrivacyLaunchGate>
          {new URLSearchParams(window.location.search).get("popup") === "git" ? (
            <QuickGitPopup onShown={onShown} />
          ) : (
            <QuickComposer onShown={onShown} />
          )}
        </PrivacyLaunchGate>
      </QueryProvider>
    </React.StrictMode>,
  );
});
