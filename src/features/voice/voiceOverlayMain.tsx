import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { bootSecondaryWindowAppearance } from "../settings/model/secondaryWindowAppearance";
import { languageReady } from "../../shared/i18n";
import { installNativeContextMenuGuard } from "../../shared/lib/nativeContextMenu";
import { readVoiceOverlayOwner } from "./model/voiceOverlay";
import { VoiceOverlayWindow } from "./ui/VoiceOverlayWindow";
import "../../styles/index.css";

installNativeContextMenuGuard();

// Theme and control geometry only; the workspace backdrop stays in the app window.
bootSecondaryWindowAppearance();

const owner = readVoiceOverlayOwner();
void languageReady.then(async () => {
  if (!owner) {
    await invoke("voice_overlay_close").catch(() => undefined);
    return;
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    // Opened only by an explicit action in an unlocked workspace window, which
    // keeps the voice session; this window mirrors what that panel already shows.
    <React.StrictMode>
      <VoiceOverlayWindow owner={owner} />
    </React.StrictMode>,
  );
});
