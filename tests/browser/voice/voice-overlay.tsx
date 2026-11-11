/**
 * Fixture evidence for the floating voice window: a stub of Tauri's IPC lets the
 * real VoiceOverlayWindow render in a browser. State is synthetic; native
 * placement, always-on-top and cross-application dragging need the desktop app.
 */
import type { VoiceOverlayState } from "../../../src/features/voice/model/voiceOverlay";
import { parseVoiceChoice } from "../../../src/features/voice/model/voiceChoices";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const label = "voice-overlay-main";
const callbacks = new Map<number, (value: unknown) => void>();
const listeners = new Map<string, number[]>();
const calls: { cmd: string; args: any }[] = [];
let next = 1;
let nativeResourceId = 1000;
const nativeResources = new Map<
  number,
  { kind: string; options: any; handler: any; index: number }
>();
let nativeMenu: any = null;
let failNativeMenu = params.has("native-menu-fail");
function publishNativeMenu() {
  if (window.parent !== window)
    window.parent.postMessage({ type: "fixture-native-menu", menu: nativeMenu }, location.origin);
}
function publishNativeFit(args: any) {
  if (window.parent !== window)
    window.parent.postMessage(
      { type: "fixture-native-fit", width: args.width, height: args.height },
      location.origin,
    );
}
function pickNativeMenu(rid: number, id: string) {
  if (nativeMenu?.rid !== rid) return;
  const menu = nativeResources.get(rid),
    node = menu?.options.items
      .map(([itemRid]: [number, string]) => nativeResources.get(itemRid))
      .find((item: any) => item?.options.id === id);
  if (!node || node.options.enabled === false) return;
  nativeMenu = null;
  publishNativeMenu();
  callbacks.get(node.handler.id)?.({ index: node.index++, message: node.options.id });
}
Object.assign(window, {
  isTauri: true,
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
      if (cmd === "plugin:menu|new") {
        const rid = nativeResourceId++,
          id = args.options?.id ?? `fixture-native-menu-${rid}`;
        nativeResources.set(rid, {
          kind: args.kind,
          options: { ...args.options, id },
          handler: args.handler,
          index: 0,
        });
        return [rid, id];
      }
      if (cmd === "plugin:menu|popup") {
        if (failNativeMenu) {
          failNativeMenu = false;
          throw new Error("Synthetic native menu denied");
        }
        const resource = nativeResources.get(args.rid);
        if (!resource || resource.kind !== "Menu") throw new Error("Unknown synthetic native menu");
        nativeMenu = {
          rid: args.rid,
          items: resource.options.items.map(([rid]: [number, string]) => {
            const item = nativeResources.get(rid);
            if (!item) throw new Error("Unknown synthetic native item");
            return {
              id: item.options.id,
              label: item.options.text,
              checked: item.options.checked,
              disabled: item.options.enabled === false,
            };
          }),
        };
        publishNativeMenu();
        return;
      }
      if (cmd === "plugin:resources|close") {
        const resource = nativeResources.get(args.rid);
        if (resource?.handler?.id)
          callbacks.get(resource.handler.id)?.({ index: resource.index, end: true });
        nativeResources.delete(args.rid);
        return;
      }
      if (cmd === "voice_overlay_fit") publishNativeFit(args);
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
  ...(params.has("manual") ? { manualTurnEnd: true } : {}),
  ...(params.has("remote")
    ? {
        notice:
          "Remote conversation history is unavailable on this Host. Voice tools use the selected remote session.",
      }
    : {}),
  privacy: "Audio is processed on this computer.",
  ...(params.has("choice")
    ? {
        choice: parseVoiceChoice({
          question: "Which project should I follow?",
          options: [
            { id: "upstream", label: "upstream" },
            { id: "clinic", label: "Clinic" },
          ],
        }),
      }
    : {}),
};
Object.assign(window, {
  fixtureOverlay: {
    calls,
    nativeMenu: () => (nativeMenu ? structuredClone(nativeMenu) : null),
    pickNativeMenu: (id: string) => pickNativeMenu(nativeMenu?.rid, id),
    emit: (patch: Partial<VoiceOverlayState>) =>
      emit("voice_overlay_state", { ...state, ...patch }),
  },
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === "fixture-native-sync") {
    const fit = [...calls].reverse().find((call) => call.cmd === "voice_overlay_fit");
    if (fit) publishNativeFit(fit.args);
    publishNativeMenu();
  }
  if (event.data?.type === "fixture-native-dismiss") {
    nativeMenu = null;
    publishNativeMenu();
  }
  if (event.data?.type === "fixture-native-pick" && nativeMenu?.rid === event.data.rid) {
    pickNativeMenu(event.data.rid, event.data.id);
  }
});

const [{ createRoot }, { VoiceOverlayWindow }, settings, i18n] = await Promise.all([
  import("react-dom/client"),
  import("../../../src/features/voice/ui/VoiceOverlayWindow"),
  import("../../../src/features/voice/model/voiceSettings"),
  import("../../../src/shared/i18n"),
  import("../../../src/styles/index.css"),
]);
await i18n.setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
settings.saveVoiceSettings({
  ...settings.loadVoiceSettings(),
  enabled: true,
  compact: params.get("compact") !== "0",
});
document.body.style.margin = "0";
const { VOICE_OVERLAY_EXPANDED_WIDTH } =
  await import("../../../src/features/voice/model/voiceOverlay");
document.getElementById("root")!.style.maxWidth = `${VOICE_OVERLAY_EXPANDED_WIDTH}px`;
createRoot(document.getElementById("root")!).render(<VoiceOverlayWindow owner="main" />);
// The owner answers the overlay's "sync" request with its snapshot.
const answer = setInterval(() => {
  if (calls.some((call) => call.cmd === "plugin:event|emit_to" && call.args?.payload === "sync")) {
    clearInterval(answer);
    emit("voice_overlay_state", state);
  }
}, 20);
