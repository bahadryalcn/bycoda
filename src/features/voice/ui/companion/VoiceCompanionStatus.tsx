import type { ComponentProps } from "react";
import { Button } from "../../../../shared/ui/Button";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { LiveText } from "../../../../shared/ui/LiveText";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Globe, MessageMultiple, Square } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { VoiceVisualizer } from "../VoiceVisualizer";
import styles from "./VoiceCompanionParts.module.css";

/** The live line: what voice is doing, the scope it applies to, and the stop for busy work. */
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
  onScopeChange: (global: boolean) => void;
  onStopWork: () => void;
}) {
  return (
    <div className={styles.status}>
      <VoiceVisualizer
        visual={visual}
        state={visualState}
        working={working}
        level={audioLevel}
        small
      />
      <div className={styles.statusText}>
        <LiveText className={styles.statusLine} text={statusText} />
        {working ? <span className={styles.caption}>{sessionStatusText}</span> : null}
      </div>
      {working && (
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          label={t("Stop work")}
          tooltip={t("Stop work")}
          onClick={onStopWork}
        >
          <Square className="icon-sm" />
        </Button>
      )}
      {idle && (
        <InfoPopover label={t("About voice")} width={260}>
          {privacy}
        </InfoPopover>
      )}
      {workspace && (
        <div className={styles.scope}>
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
        </div>
      )}
    </div>
  );
}
