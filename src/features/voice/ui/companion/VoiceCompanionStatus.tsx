import type { ComponentProps } from "react";
import { Button } from "../../../../shared/ui/Button";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { LiveText } from "../../../../shared/ui/LiveText";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import { Globe, MessageMultiple, Square } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { AssistantAvatarMark } from "../../../assistant/public/avatar";
import { VoiceVisualizer } from "../VoiceVisualizer";
import { voiceStatusTone } from "./VoiceLauncher";
import styles from "./VoiceCompanionParts.module.css";

/**
 * The stage of the expanded panel. Row one never wraps: the assistant's avatar with a state ring,
 * what voice is doing (one line) over what it applies to, and the audio visual. Row two holds the
 * scope choice, so no state moves another control.
 */
export function VoiceCompanionStatus({
  visual,
  visualState,
  working,
  audioLevel,
  statusText,
  sessionStatusText,
  idle,
  privacy,
  workspace,
  globalScope,
  name,
  avatar,
  onScopeChange,
  onStopWork,
}: {
  visual: ComponentProps<typeof VoiceVisualizer>["visual"];
  visualState: ComponentProps<typeof VoiceVisualizer>["state"];
  working: boolean;
  audioLevel: { readonly current: number };
  statusText: string;
  sessionStatusText: string;
  idle: boolean;
  privacy: string;
  workspace: boolean;
  globalScope: boolean;
  /** Assistant name; empty before setup, when there is no avatar to show. */
  name: string;
  avatar: string | undefined;
  onScopeChange: (global: boolean) => void;
  onStopWork: () => void;
}) {
  const tone = voiceStatusTone(visualState);
  const caption = working ? sessionStatusText : "";
  return (
    <div className={styles.stage}>
      <div className={styles.status}>
        {name ? (
          <span className={styles.avatar} data-state={visualState}>
            <AssistantAvatarMark className={styles.avatarMark} value={avatar} name={name} />
            {tone && (
              <StatusDot className={styles.avatarDot} tone={tone} size="fixed" appearance="solid" />
            )}
          </span>
        ) : null}
        <div className={styles.statusText}>
          <LiveText className={styles.statusLine} text={statusText} />
          {caption ? (
            <OverflowTooltip label={caption}>
              <span className={styles.caption}>{caption}</span>
            </OverflowTooltip>
          ) : null}
        </div>
        {working && (
          <Button iconOnly size="sm" variant="ghost" label={t("Stop work")} onClick={onStopWork}>
            <Square className="icon-sm" />
          </Button>
        )}
        <VoiceVisualizer
          visual={visual}
          state={visualState}
          working={working}
          level={audioLevel}
          small
        />
      </div>
      {(workspace || idle) && (
        <div className={styles.scope}>
          {workspace && (
            <SegmentedControl
              label={t("Voice scope")}
              value={globalScope ? "global" : "session"}
              onValueChange={(value) => onScopeChange(value === "global")}
              options={[
                { value: "global", label: t("Global"), icon: <Globe className="icon-sm" /> },
                {
                  value: "session",
                  label: t("Project"),
                  icon: <MessageMultiple className="icon-sm" />,
                },
              ]}
            />
          )}
          {idle && (
            <InfoPopover label={t("About voice")} width={260} className={styles.scopeEnd}>
              {privacy}
            </InfoPopover>
          )}
        </div>
      )}
    </div>
  );
}
