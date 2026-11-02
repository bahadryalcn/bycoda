import { useEffect, useLayoutEffect, useRef } from "react";
import {
  VOICE_OVERLAY_CLOSED_EVENT,
  VOICE_OVERLAY_COMMAND_EVENT,
  VOICE_OVERLAY_CHOICE_EVENT,
  VOICE_OVERLAY_JOB_EVENT,
  VOICE_OVERLAY_LEVEL_EVENT,
  VOICE_OVERLAY_STATE_EVENT,
  closeVoiceOverlay,
  isVoiceOverlayCommand,
  voiceOverlayLabel,
  type VoiceOverlayCommand,
  type VoiceOverlayState,
} from "../model/voiceOverlay";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type {VoiceJobDraft} from "../model/voiceJobs";

/** About 12 frames a second is enough for the small orb and keeps IPC light. */
const LEVEL_INTERVAL_MS = 80;

/**
 * Workspace side of the floating voice window: mirrors state out, takes
 * commands in. Audio never leaves this window.
 */
export function useVoiceOverlayHost(options: {
  detached: boolean;
  state: VoiceOverlayState;
  level: { readonly current: number };
  onCommand: (command: VoiceOverlayCommand) => void;
  onChoice?: (id: string, reply: UserQuestionReply) => void;
  onChoiceRetry?:(id:string)=>void;
  onJobReview?:(id:string,action:"change"|"start"|"cancel",rows?:VoiceJobDraft[])=>void;
  onClosed: () => void;
}) {
  const { detached, state, level } = options;
  const handlers = useRef(options);
  useLayoutEffect(() => {
    handlers.current = options;
  });
  const snapshot = JSON.stringify(state);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const label = useRef<string | null>(null);

  useEffect(() => {
    if (!detached) return;
    let disposed = false;
    const unlisten: (() => void)[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const [{ getCurrentWebviewWindow }, { emitTo }] = await Promise.all([
        import("@tauri-apps/api/webviewWindow"),
        import("@tauri-apps/api/event"),
      ]);
      if (disposed) return;
      const current = getCurrentWebviewWindow();
      const target = voiceOverlayLabel(current.label);
      label.current = target;
      const send = () =>
        void emitTo(target, VOICE_OVERLAY_STATE_EVENT, JSON.parse(latestSnapshot.current)).catch(
          () => undefined,
        );
      // Scoped to this window: a global listener would also receive other
      // workspace windows' overlay traffic.
      const subscriptions = await Promise.all([
        current.listen<{id:string;action:"change"|"start"|"cancel";rows?:VoiceJobDraft[]}>(VOICE_OVERLAY_JOB_EVENT,({payload})=>{
          if(payload&&typeof payload.id==="string"&&["change","start","cancel"].includes(payload.action)&&(payload.rows===undefined||Array.isArray(payload.rows)))handlers.current.onJobReview?.(payload.id,payload.action,payload.rows);
        }),
        current.listen<{id:string;reply?:UserQuestionReply;action?:"retry"}>(VOICE_OVERLAY_CHOICE_EVENT, ({payload}) => {
          if(payload&&typeof payload.id==="string"){
            if(payload.action==="retry"&&payload.reply===undefined)handlers.current.onChoiceRetry?.(payload.id);
            else if(payload.action===undefined&&payload.reply)handlers.current.onChoice?.(payload.id,payload.reply);
          }
        }),
        current.listen<unknown>(VOICE_OVERLAY_COMMAND_EVENT, ({ payload }) => {
          if (!isVoiceOverlayCommand(payload)) return;
          if (payload === "sync") send();
          else handlers.current.onCommand(payload);
        }),
        current.listen(VOICE_OVERLAY_CLOSED_EVENT, () => handlers.current.onClosed()),
      ]);
      if (disposed) {
        for (const stop of subscriptions) stop();
        return;
      }
      unlisten.push(...subscriptions);
      send();
      let last = -1;
      timer = setInterval(() => {
        const value = Math.round(Math.max(0, Math.min(1, level.current || 0)) * 100) / 100;
        if (value === last) return;
        last = value;
        void emitTo(target, VOICE_OVERLAY_LEVEL_EVENT, value).catch(() => undefined);
      }, LEVEL_INTERVAL_MS);
    })().catch(() => undefined);
    return () => {
      disposed = true;
      clearInterval(timer);
      for (const stop of unlisten) stop();
      label.current = null;
      // Docking, closing or unmounting the companion: the mirror has nothing left to show.
      void closeVoiceOverlay().catch(() => undefined);
    };
  }, [detached, level]);

  useEffect(() => {
    const target = label.current;
    if (!detached || !target) return;
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo(target, VOICE_OVERLAY_STATE_EVENT, JSON.parse(snapshot)))
      .catch(() => undefined);
  }, [detached, snapshot]);
}
