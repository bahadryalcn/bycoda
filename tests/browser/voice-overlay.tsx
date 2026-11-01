/**
 * Fixture evidence for the floating voice window: a stub of Tauri's IPC lets the
 * real VoiceOverlayWindow render in a browser. State is synthetic; native
 * placement, always-on-top and cross-application dragging need the desktop app.
 */
import type { VoiceOverlayState } from "../../src/features/voice/model/voiceOverlay";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const label = "voice-overlay-main";
const callbacks = new Map<number, (value: unknown) => void>();
const listeners = new Map<string, number[]>();
const calls: { cmd: string; args: any }[] = [];
let next = 1;
Object.assign(window, {
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label },
      currentWebview: { label, windowLabel: label },
    },
    transformCallback(callback: (value: unknown) => void) {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    async invoke(cmd: string, args: any) {
      calls.push({ cmd, args });
      if (cmd === "plugin:event|listen") {
        listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
        return args.handler;
      }
      return null;
    },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
});
function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
}
const state: VoiceOverlayState = {
  status: params.get("status") === "idle" ? "idle" : "live",
  visualState: params.get("status") === "idle" ? "off" : "assistant",
  statusText: params.get("status") === "idle" ? "Ready to connect" : "Assistant speaking",
  title: "Voice companion düzeltmeleri · a long session title to verify truncation",
  muted: false,
  working: true,
  canStart: true,
  transcript: "Testler geçti mi, ve hangi dosyalar değişti?",
  message:
    "Evet, 238 test geçti. VoiceCompanion.tsx, yeni yüzen pencere ve Rust tarafındaki voice_overlay modülü değişti.",
  error: "",
  privacy: "Audio is processed on this computer.",
};
Object.assign(window, {
  fixtureOverlay: {
    calls,
    emit: (patch: Partial<VoiceOverlayState>) =>
      emit("voice_overlay_state", { ...state, ...patch }),
  },
});

const [{ createRoot }, { VoiceOverlayWindow }, settings, i18n] = await Promise.all([
  import("react-dom/client"),
  import("../../src/features/voice/ui/VoiceOverlayWindow"),
  import("../../src/features/voice/model/voiceSettings"),
  import("../../src/shared/i18n"),
  import("../../src/styles/index.css"),
]);
await i18n.setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
settings.saveVoiceSettings({
  ...settings.loadVoiceSettings(),
  enabled: true,
  compact: params.get("compact") !== "0",
});
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(<VoiceOverlayWindow owner="main" />);
// The owner answers the overlay's "sync" request with its snapshot.
const answer = setInterval(() => {
  if (calls.some((call) => call.cmd === "plugin:event|emit_to" && call.args?.payload === "sync")) {
    clearInterval(answer);
    emit("voice_overlay_state", state);
  }
}, 20);
