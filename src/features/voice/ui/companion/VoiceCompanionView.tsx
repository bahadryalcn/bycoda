import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import {
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { LiveText } from "../../../../shared/ui/LiveText";
import { motionAttributes } from "../../../../shared/ui/Motion";
import { useOverlay } from "../../../../shared/ui/overlay";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { OverflowTooltip, Tooltip } from "../../../../shared/ui/Tooltip";
import {
  Maximize2,
  MessageSquare,
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
import { callArtworkState, type VoiceCallPhase } from "./voiceCallArtwork";

export type VoiceCompanionViewProps = {
  compact: boolean;
  fullScreen?: boolean;
  workPanel?: ReactNode;
  onToggleWorkPanel?: () => void;
  workPanelToggleRef?: RefObject<HTMLButtonElement | null>;
  onToggleFullScreen?: () => void;
  status: Status;
  phase?: VoiceCallPhase;
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
  const [chatRequested, setChatShown] = useState(false);
  const canShowDrawers = !p.fullScreen || (!p.choice && !p.jobReview);
  const chatShown = chatRequested && canShowDrawers;
  const chatToggle = useRef<HTMLButtonElement>(null);
  const chatPanel = useRef<HTMLElement>(null);
  const closeChat = () => {
    setChatShown(false);
    chatToggle.current?.focus();
  };
  useOverlay(chatPanel, false, closeChat, Boolean(p.fullScreen && chatShown), undefined, false);
  const chatPanelId = useId();
  const chatLabelId = useId();
  const workPanelId = useId();
  const artwork = p.fullScreen ? callArtworkState(p.status, p.visualState, p.phase) : p.visualState;
  const drawerMotion = motionAttributes(
    {
      enter: canShowDrawers && p.workPanel && !chatShown ? "right" : undefined,
      duration: "standard",
    },
    styles.workDrawer,
  );
  const caption = p.chatTurns[p.chatTurns.length - 1]?.text ?? "";
  return (
    <>
      {!p.compact && (p.fullScreen || !chatShown) && (
        <VoiceCallScene
          part="backdrop"
          state={artwork}
          level={audioLevel}
          className={styles.stageLight}
          expanded={p.fullScreen}
        />
      )}
      <header
        {...surfaceAttributes(
          { frame: p.compact ? "none" : "pane", edge: "block-end" },
          styles.header,
        )}
        {...p.headerDrag}
      >
        {p.handle}
        {/* The expanded panel shows the error notice itself; the mark only stands in when compact. */}
        {p.error && p.compact ? (
          <VoiceErrorMark error={p.error} onShow={p.onToggleCompact} />
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
            {p.fullScreen && canShowDrawers && (
              <Button
                ref={chatToggle}
                touchTarget="control"
                label={t("Chat")}
                startIcon={<MessageSquare className="icon-sm" />}
                aria-expanded={chatShown}
                aria-controls={chatPanelId}
                selected={chatShown}
                onClick={() => setChatShown(!chatShown)}
              >
                {t("Chat")}
              </Button>
            )}
            <VoiceOptionsMenu onFloat={p.canDetach ? p.onFloat : undefined} />
            {p.fullScreen && canShowDrawers && p.onToggleWorkPanel ? (
              <Button
                ref={p.workPanelToggleRef}
                touchTarget="control"
                iconOnly
                label={t("Live results")}
                aria-expanded={Boolean(p.workPanel) && !chatShown}
                aria-controls={workPanelId}
                onClick={() => {
                  setChatShown(false);
                  if (!chatShown || !p.workPanel) p.onToggleWorkPanel?.();
                }}
              >
                {p.workPanel && !chatShown ? (
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
            data-call-stage={p.fullScreen || !chatShown || undefined}
            data-call-live={live || undefined}
          >
            <VoiceCompanionStatus
              visualState={p.visualState}
              artwork={artwork}
              fullScreen={p.fullScreen}
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
              stage={Boolean(p.fullScreen) || !chatShown}
              caption={caption}
              onScopeChange={p.onScopeChange}
              onStopWork={p.onStopWork}
            />
            {p.sessionPicker}
            {!p.fullScreen && chatShown ? <VoiceChatTranscript turns={p.chatTurns} /> : null}
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
            <section
              ref={chatPanel}
              id={chatPanelId}
              aria-labelledby={chatLabelId}
              hidden={!chatShown}
              {...surfaceAttributes(
                { variant: "opaque-canvas", frame: "pane", edge: "responsive-start" },
                styles.chatDrawer,
              )}
            >
              {chatShown && (
                <>
                  <div className={styles.chatHeader}>
                    <SectionLabel as="h3" id={chatLabelId}>
                      {t("Conversation")}
                    </SectionLabel>
                    <Button touchTarget="control" iconOnly label={t("Close")} onClick={closeChat}>
                      <X className="icon-sm" />
                    </Button>
                  </div>
                  {p.chatTurns.length ? (
                    <VoiceChatTranscript turns={p.chatTurns} />
                  ) : (
                    <EmptyState title={t("No messages yet")} context="panel" />
                  )}
                </>
              )}
            </section>
          )}
          {p.fullScreen && (
            <div
              id={workPanelId}
              hidden={!canShowDrawers || !p.workPanel || chatShown}
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
              { frame: !p.fullScreen && chatShown ? "pane" : "none", edge: "block-start" },
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
              onToggleChat={p.fullScreen ? undefined : () => setChatShown(!chatShown)}
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
