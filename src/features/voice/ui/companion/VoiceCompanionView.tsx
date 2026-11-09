import type { ReactNode, RefObject } from "react";
import { Button } from "../../../../shared/ui/Button";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LiveText } from "../../../../shared/ui/LiveText";
import { OverflowTooltip, Tooltip } from "../../../../shared/ui/Tooltip";
import { Maximize2, Mic, MicOff, Minimize2, Square, X } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { truncateGraphemes } from "../../../../shared/lib/text/truncate";
import type { VoiceToolActivityEntry } from "../../model/voiceToolActivity";
import { VoiceOptionsMenu } from "../VoicePanelChoices";
import { VoiceToolActivityPanel } from "../VoiceToolActivityPanel";
import { VoiceVisualizer } from "../VoiceVisualizer";
import styles from "../VoiceCompanion.module.css";
import { VoiceChatTranscript } from "./VoiceChatTranscript";
import { VoiceCompanionControls } from "./VoiceCompanionControls";
import { VoiceCompanionMoreMenu } from "./VoiceCompanionMoreMenu";
import { VoiceCompanionStatus } from "./VoiceCompanionStatus";
import type { VoiceChatTurn, VoiceCompanionStatus as Status } from "./voiceCompanionTypes";
import parts from "./VoiceCompanionParts.module.css";

export type VoiceCompanionViewProps = {
  compact: boolean;
  status: Status;
  /** The drag handle: the orb in compact mode, the grip when expanded. */
  handle: ReactNode;
  visual: Parameters<typeof VoiceVisualizer>[0]["visual"];
  visualState: Parameters<typeof VoiceVisualizer>[0]["state"];
  working: boolean;
  audioLevel: { readonly current: number };
  title: string;
  scopeTitle: string;
  targetTitle?: string;
  summary: string;
  muted: boolean;
  speakerMuted: boolean;
  manual: boolean;
  statusText: string;
  sessionStatusText: string;
  startDisabled: boolean;
  privacy: string;
  pushHint: string;
  workspace: boolean;
  globalScope: boolean;
  canDetach: boolean;
  toolActivities: VoiceToolActivityEntry[];
  chatTurns: readonly VoiceChatTurn[];
  error: string;
  actionableError: boolean;
  liveText: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  sessionPicker: ReactNode;
  choice: ReactNode;
  jobReview: ReactNode;
  recovery: ReactNode;
  onScopeChange: (global: boolean) => void;
  onFloat: () => void;
  onStopWaiting: (id: string) => void;
  onStopWork: () => void;
  onStart: () => void;
  onClose: () => void;
  onDismiss: () => void;
  onToggleCompact: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onSilence: () => void;
  onFinish: () => void;
  onManualChange: (manual: boolean) => void;
};

/**
 * The companion's panel content. Expanded: header with actions and options, the live status
 * line, a chat transcript, and a footer of icon controls. Compact: a pill with the live line,
 * mic, end and an overflow menu.
 */
export function VoiceCompanionView({ audioLevel, toggleRef, ...p }: VoiceCompanionViewProps) {
  const live = p.status === "live";
  const canTalk = p.status === "idle" || p.status === "sleeping" || p.status === "ready";
  const connecting = p.status === "connecting" || p.status === "reconnecting";
  const micLabel = t(
    canTalk ? (p.status === "idle" ? "Start voice" : "Talk") : p.muted ? "Resume" : "Pause mic",
  );
  const toggleLabel = t(p.compact ? "Expand voice companion" : "Compact voice companion");
  return (
    <>
      <header className={styles.header}>
        {p.handle}
        {p.compact ? (
          <div className={styles.heading}>
            <Tooltip
              asChild
              label={p.targetTitle}
              when={p.targetTitle && p.targetTitle !== p.scopeTitle ? "always" : "overflow"}
            >
              <h2 className={styles.title}>
                {p.title} · {p.scopeTitle}
              </h2>
            </Tooltip>
            <OverflowTooltip label={p.summary}>
              <span className={styles.summary} aria-hidden="true">
                {truncateGraphemes(p.summary, 96)}
              </span>
            </OverflowTooltip>
          </div>
        ) : (
          <h2 className={styles.title}>{p.title}</h2>
        )}
        {p.compact ? (
          <>
            <Button
              iconOnly
              variant={canTalk || (live && !p.muted) ? "primary" : "secondary"}
              tone={p.muted ? "danger" : undefined}
              label={micLabel}
              tooltip={micLabel}
              loading={connecting}
              disabled={canTalk ? p.startDisabled : !live}
              selected={live && p.muted}
              aria-pressed={canTalk ? undefined : p.muted}
              onClick={() => (canTalk ? p.onStart() : p.onToggleMute())}
            >
              {p.muted || p.status === "ready" || p.status === "sleeping" ? (
                <MicOff className="icon-sm" />
              ) : (
                <Mic className="icon-sm" />
              )}
            </Button>
            {p.status !== "idle" && (
              <Button
                iconOnly
                variant="danger"
                label={t("Disconnect voice")}
                tooltip={t("Disconnect voice")}
                onClick={p.onClose}
              >
                <Square className="icon-sm" />
              </Button>
            )}
            <VoiceCompanionMoreMenu
              live={live}
              manual={p.manual}
              muted={p.muted}
              speakerMuted={p.speakerMuted}
              onManualChange={p.onManualChange}
              onFinish={p.onFinish}
              onToggleSpeaker={p.onToggleSpeaker}
            />
          </>
        ) : (
          <>
            <VoiceToolActivityPanel entries={p.toolActivities} onStopWaiting={p.onStopWaiting} />
            <VoiceOptionsMenu onFloat={p.canDetach ? p.onFloat : undefined} />
          </>
        )}
        <Button
          ref={toggleRef}
          iconOnly
          label={toggleLabel}
          tooltip={toggleLabel}
          aria-expanded={!p.compact}
          onClick={p.onToggleCompact}
        >
          {p.compact ? <Maximize2 className="icon-sm" /> : <Minimize2 className="icon-sm" />}
        </Button>
        {!p.compact && (
          <Button
            iconOnly
            label={t("Close voice companion")}
            tooltip={t("Close voice companion")}
            onClick={p.onDismiss}
          >
            <X className="icon-sm" />
          </Button>
        )}
      </header>
      <LiveText className={styles.srOnly} text={p.liveText} />
      {/* Unmounted when compact so open menus and popovers close with the expanded panel. */}
      {!p.compact && (
        <>
          <div className={styles.body}>
            {p.sessionPicker}
            <VoiceCompanionStatus
              visual={p.visual}
              visualState={p.visualState}
              working={p.working}
              audioLevel={audioLevel}
              statusText={p.statusText}
              sessionStatusText={p.sessionStatusText}
              idle={p.status === "idle"}
              privacy={p.privacy}
              workspace={p.workspace}
              globalScope={p.globalScope}
              onScopeChange={p.onScopeChange}
              onStopWork={p.onStopWork}
            />
            {p.choice}
            {p.jobReview}
            <VoiceChatTranscript turns={p.chatTurns} />
            {p.error ? (
              p.actionableError ? (
                <InlineError className={parts.errorRow}>{p.error}</InlineError>
              ) : (
                <div className={parts.errorRow}>
                  <InlineError>{t("Voice needs attention")}</InlineError>
                  <Disclosure size="sm" className={styles.feedback} summary={t("Error details")}>
                    <p>{p.error}</p>
                  </Disclosure>
                </div>
              )
            ) : null}
            {p.recovery}
            {p.pushHint ? <p className={parts.caption}>{p.pushHint}</p> : null}
          </div>
          <div className={styles.actions}>
            <VoiceCompanionControls
              status={p.status}
              startDisabled={p.startDisabled}
              muted={p.muted}
              speakerMuted={p.speakerMuted}
              manual={p.manual}
              onStart={p.onStart}
              onClose={p.onClose}
              onToggleMute={p.onToggleMute}
              onToggleSpeaker={p.onToggleSpeaker}
              onSilence={p.onSilence}
              onFinish={p.onFinish}
              onManualChange={p.onManualChange}
            />
          </div>
        </>
      )}
    </>
  );
}
