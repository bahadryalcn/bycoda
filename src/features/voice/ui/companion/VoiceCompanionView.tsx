import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { Button } from "../../../../shared/ui/Button";
import { LiveText } from "../../../../shared/ui/LiveText";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
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
import { VoiceErrorMark, VoiceErrorNotice, voiceErrorTitle } from "./VoiceErrorNotice";
import { VoiceSidePanel } from "./VoiceSidePanel";
import type { VoiceChatTurn, VoiceCompanionStatus as Status } from "./voiceCompanionTypes";
import parts from "./VoiceCompanionParts.module.css";

export type VoiceCompanionViewProps = {
  compact: boolean;
  status: Status;
  /** The drag handle: the orb in compact mode, the grip when expanded. */
  handle: ReactNode;
  /** Pointer handlers that let the whole header, not only the handle, move the panel. */
  headerDrag?: HTMLAttributes<HTMLElement>;
  visualState: Parameters<typeof VoiceVisualizer>[0]["state"];
  working: boolean;
  audioLevel: { readonly current: number };
  title: string;
  /** Assistant name and avatar for the stage; the name is empty before setup. */
  name: string;
  avatar: string | undefined;
  scopeTitle: string;
  targetTitle?: string;
  summary: string;
  muted: boolean;
  speakerMuted: boolean;
  manual: boolean;
  statusText: string;
  sessionStatusText: string;
  startDisabled: boolean;
  /** Who runs the voice: the realtime provider's name or this computer. */
  engine: string;
  privacy: string;
  pushHint: string;
  workspace: boolean;
  globalScope: boolean;
  canDetach: boolean;
  toolActivities: VoiceToolActivityEntry[];
  chatTurns: readonly VoiceChatTurn[];
  error: string;
  /** The owner acknowledged the error: clear it. */
  onDismissError: () => void;
  liveText: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  sessionPicker: ReactNode;
  choice: ReactNode;
  jobReview: ReactNode;
  recovery: ReactNode;
  /** The companion element; questions open in a panel placed beside it. */
  panel?: RefObject<HTMLElement | null>;
  /** Id of the open question or review, so a new one scrolls to its actions. */
  sideKey?: string;
  /** Resize grip of the expanded panel, in the header beside the size toggle. */
  resize?: ReactNode;
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
 * line, a chat transcript and a footer of icon controls; open questions get a panel beside it. Compact: a pill with the live line,
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
      <header
        {...surfaceAttributes(
          { frame: p.compact ? "none" : p.error ? "danger" : "neutral", edge: "block-end" },
          styles.header,
        )}
        {...p.headerDrag}
      >
        {p.handle}
        {p.error ? (
          <VoiceErrorMark error={p.error} onShow={p.compact ? p.onToggleCompact : undefined} />
        ) : null}
        {p.compact ? (
          <Text as="div" size="inherit" tone="inherit" leading="snug" className={styles.heading}>
            <Tooltip
              asChild
              label={p.targetTitle}
              when={p.targetTitle && p.targetTitle !== p.scopeTitle ? "always" : "overflow"}
            >
              <SectionLabel as="h2" className={styles.title}>
                {p.title} · {p.scopeTitle}
              </SectionLabel>
            </Tooltip>
            <OverflowTooltip label={p.summary}>
              <Text
                truncate
                size="caption"
                tone="secondary"
                leading="inherit"
                className={styles.summary}
                aria-hidden="true"
              >
                {truncateGraphemes(p.summary, 96)}
              </Text>
            </OverflowTooltip>
          </Text>
        ) : (
          <SectionLabel as="h2" className={styles.title}>
            {p.title}
          </SectionLabel>
        )}
        {p.compact ? (
          <>
            <Button
              touchTarget="control"
              iconOnly
              variant={canTalk || (live && !p.muted) ? "primary" : "secondary"}
              tone={p.muted ? "danger" : undefined}
              label={micLabel}
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
                touchTarget="control"
                iconOnly
                variant="danger"
                label={t("Disconnect voice")}
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
            <VoiceToolActivityPanel
              touchTarget="control"
              entries={p.toolActivities}
              onStopWaiting={p.onStopWaiting}
            />
            <VoiceOptionsMenu onFloat={p.canDetach ? p.onFloat : undefined} />
            {p.resize}
          </>
        )}
        <Button
          touchTarget="control"
          ref={toggleRef}
          iconOnly
          label={toggleLabel}
          aria-expanded={!p.compact}
          onClick={p.onToggleCompact}
        >
          {p.compact ? <Maximize2 className="icon-sm" /> : <Minimize2 className="icon-sm" />}
        </Button>
        {!p.compact && (
          <Button
            touchTarget="control"
            iconOnly
            label={t("Close voice companion")}
            onClick={p.onDismiss}
          >
            <X className="icon-sm" />
          </Button>
        )}
      </header>
      <LiveText {...surfaceAttributes({ frame: "none" }, "sr-only")} text={p.liveText} />
      {/* Unmounted when compact so open menus and popovers close with the expanded panel. */}
      {!p.compact && (
        <>
          <div className={styles.body}>
            <VoiceCompanionStatus
              visualState={p.visualState}
              working={p.working}
              audioLevel={audioLevel}
              statusText={p.statusText}
              sessionStatusText={p.sessionStatusText}
              live={live}
              engine={p.engine}
              privacy={p.privacy}
              workspace={p.workspace}
              globalScope={p.globalScope}
              name={p.name}
              avatar={p.avatar}
              onScopeChange={p.onScopeChange}
              onStopWork={p.onStopWork}
            />
            {p.sessionPicker}
            <VoiceChatTranscript turns={p.chatTurns} />
            {p.error ? <VoiceErrorNotice error={p.error} onDismiss={p.onDismissError} /> : null}
            <LiveText
              mode="assertive"
              {...surfaceAttributes({ frame: "none" }, "sr-only")}
              text={[...new Set(p.error ? [voiceErrorTitle(p.error), p.error] : [])].join(": ")}
            />
            {p.recovery}
            {p.pushHint ? (
              <Text as="p" size="caption" tone="secondary" leading="snug" className={parts.caption}>
                {p.pushHint}
              </Text>
            ) : null}
          </div>
          {/* Questions and job review open in their own panel beside the companion, so the
              conversation stays readable while they are answered. */}
          {(p.choice || p.jobReview) && p.panel ? (
            <VoiceSidePanel panel={p.panel} openKey={p.sideKey ?? ""}>
              {p.choice}
              {p.jobReview}
            </VoiceSidePanel>
          ) : null}
          <div {...surfaceAttributes({ frame: "neutral", edge: "block-start" }, styles.actions)}>
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
