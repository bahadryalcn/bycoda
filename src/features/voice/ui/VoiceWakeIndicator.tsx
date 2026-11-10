import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { t } from "../../../shared/i18n";
import styles from "./VoiceWakeIndicator.module.css";

export type WakeIndicatorState =
  | { kind: "listening"; phrase: string }
  | { kind: "paused" }
  | { kind: "pack" }
  | { kind: "error" };

/** Persistent mark while the microphone listens only for the wake phrase; one click turns it off. */
export function VoiceWakeIndicator({
  state,
  onOff,
  onSetup,
}: {
  state: WakeIndicatorState;
  onOff: () => void;
  onSetup: () => void;
}) {
  const text =
    state.kind === "listening"
      ? t("Listening for “{p0}” only", { p0: state.phrase })
      : state.kind === "paused"
        ? t("Paused: too much background speech")
        : state.kind === "pack"
          ? t("Wake phrase needs the local voice pack")
          : t("Wake phrase stopped listening. Check the microphone.");
  return (
    <div className={styles.indicator} data-state={state.kind}>
      <StatusDot
        tone={state.kind === "listening" ? "success" : "warning"}
        appearance="solid"
        size="sm"
      />
      <OverflowTooltip label={text}>
        <span className={styles.text}>{text}</span>
      </OverflowTooltip>
      {state.kind === "pack" ? (
        <Button size="sm" variant="ghost" onClick={onSetup}>
          {t("Set up voice")}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onOff}>
        {t("Turn off")}
      </Button>
    </div>
  );
}
