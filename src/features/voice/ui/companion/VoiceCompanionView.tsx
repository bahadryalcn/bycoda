import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { useId, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { Button } from "../../../../shared/ui/Button";
import { LiveText } from "../../../../shared/ui/LiveText";
import { motionAttributes } from "../../../../shared/ui/Motion";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { OverflowTooltip, Tooltip } from "../../../../shared/ui/Tooltip";
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Minus,
  PanelRight,
  PanelRightClose,
  Square,
  X,
} from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { truncateGraphemes } from "../../../../shared/lib/text/truncate";
import type { VoiceToolActivityEntry } from "../../model/voiceToolActivity";
import { VoiceOptionsMenu } from "../VoicePanelChoices";
import { VoiceToolActivityPanel } from "../VoiceToolActivityPanel";
import { VoiceVisualizer } from "../VoiceVisualizer";
import styles from "../VoiceCompanion.module.css";
import { VoiceCallScene } from "./VoiceCallScene";
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
  fullScreen?: boolean;
  workPanel?: ReactNode;
  onToggleWorkPanel?: () => void;
  workPanelToggleRef?: RefObject<HTMLButtonElement | null>;
  onOpenSuggestedWork?: () => void;
  workSuggestion?: boolean;
  onDismissWorkSuggestion?: () => void;
  onToggleFullScreen?: () => void;
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
  const micLabel = t(canTalk ? (p.status === "idle" ? "Start voice" : "Talk") : "Mute microphone");
  const toggleLabel = t(
    p.compact
      ? "Expand voice companion"
      : p.fullScreen
        ? "Exit full screen"
        : p.onToggleFullScreen
          ? "Full screen"
          : "Compact voice companion",
  );
  // Like the phone call screen: a large stage by default, the transcript on request. Kept here,
  // above the compact switch, so the choice survives collapsing the panel.
  const [chatShown, setChatShown] = useState(false);
  const workPanelId = useId();
  const drawerMotion = motionAttributes(
    { enter: p.workPanel ? "right" : undefined, duration: "standard" },
    styles.workDrawer,
  );
  const caption = p.chatTurns[p.chatTurns.length - 1]?.text ?? "";
  return (
    <>
      {!p.compact && !chatShown && (
        <VoiceCallScene
          part="backdrop"
          state={p.visualState}
          level={audioLevel}
          className={styles.stageLight}
        />
      )}
      <header
        {...surfaceAttributes(
          { frame: p.compact ? "none" : p.error ? "danger" : "pane", edge: "block-end" },
          styles.header,
        )}
        {...p.headerDrag}
        data-work-suggestion={p.workSuggestion || undefined}
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
              pressed={canTalk ? undefined : p.muted}
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
                tone="danger"
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
            {p.workSuggestion ? (
              <div className={styles.workSuggestion}>
                <Button onClick={p.onOpenSuggestedWork}>{t("View live work")}</Button>
                <Button iconOnly label={t("Dismiss")} onClick={p.onDismissWorkSuggestion}>
                  <X className="icon-sm" />
                </Button>
              </div>
            ) : null}
            <VoiceOptionsMenu onFloat={p.canDetach ? p.onFloat : undefined} />
            {p.fullScreen && p.onToggleWorkPanel ? (
              <Button
                ref={p.workPanelToggleRef}
                touchTarget="control"
                iconOnly
                label={t("Activity")}
                aria-expanded={Boolean(p.workPanel)}
                aria-controls={workPanelId}
                onClick={p.onToggleWorkPanel}
              >
                {p.workPanel ? (
                  <PanelRightClose className="icon-sm" />
                ) : (
                  <PanelRight className="icon-sm" />
                )}
              </Button>
            ) : null}
            {p.resize}
            {p.onToggleFullScreen && !p.fullScreen ? (
              <Button
                touchTarget="control"
                iconOnly
                label={t("Compact voice companion")}
                onClick={p.onToggleCompact}
              >
                <Minus className="icon-sm" />
              </Button>
            ) : null}
          </>
        )}
        <Button
          touchTarget="control"
          ref={toggleRef}
          iconOnly
          label={toggleLabel}
          aria-expanded={p.compact || !p.onToggleFullScreen ? !p.compact : undefined}
          aria-pressed={!p.compact && p.onToggleFullScreen ? Boolean(p.fullScreen) : undefined}
          onClick={!p.compact && p.onToggleFullScreen ? p.onToggleFullScreen : p.onToggleCompact}
        >
          {p.compact || (p.onToggleFullScreen && !p.fullScreen) ? (
            <Maximize2 className="icon-sm" />
          ) : (
            <Minimize2 className="icon-sm" />
          )}
        </Button>
        {!p.compact && !p.fullScreen && (
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
          <div
            className={styles.body}
            data-call-stage={!chatShown || undefined}
            data-call-live={live || undefined}
          >
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
              stage={!chatShown}
              caption={caption}
              onScopeChange={p.onScopeChange}
              onStopWork={p.onStopWork}
            />
            {p.sessionPicker}
            {chatShown ? <VoiceChatTranscript turns={p.chatTurns} /> : null}
            {p.error ? (
              <VoiceErrorNotice
                error={p.error}
                onDismiss={p.onDismissError}
                onReconnect={canTalk ? p.onStart : undefined}
              />
            ) : null}
            <LiveText
              mode="assertive"
              {...surfaceAttributes({ frame: "none" }, "sr-only")}
              text={[...new Set(p.error ? [voiceErrorTitle(p.error), p.error] : [])].join(": ")}
            />
            {p.recovery}
            {p.fullScreen ? (
              <>
                {p.choice}
                {p.jobReview}
              </>
            ) : null}
            {p.pushHint ? (
              <Text as="p" size="caption" tone="secondary" leading="snug" className={parts.caption}>
                {p.pushHint}
              </Text>
            ) : null}
          </div>
          {/* Questions and job review open in their own panel beside the companion, so the
              conversation stays readable while they are answered. */}
          {!p.fullScreen && (p.choice || p.jobReview) && p.panel ? (
            <VoiceSidePanel
              panel={p.panel}
              label={p.choice ? t("Question") : t("Review jobs before starting")}
              openKey={p.sideKey ?? ""}
            >
              {p.choice}
              {p.jobReview}
            </VoiceSidePanel>
          ) : null}
          {p.fullScreen && (
            <div
              id={workPanelId}
              hidden={!p.workPanel}
              {...drawerMotion}
              {...surfaceAttributes(
                { variant: "opaque-canvas", frame: "pane", edge: "responsive-start" },
                drawerMotion.className,
              )}
            >
              {p.workPanel}
            </div>
          )}
          <div
            {...surfaceAttributes(
              { frame: chatShown ? "pane" : "none", edge: "block-start" },
              styles.actions,
            )}
          >
            <VoiceCompanionControls
              status={p.status}
              startDisabled={p.startDisabled}
              muted={p.muted}
              speakerMuted={p.speakerMuted}
              manual={p.manual}
              chatShown={chatShown}
              onToggleChat={() => setChatShown(!chatShown)}
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
