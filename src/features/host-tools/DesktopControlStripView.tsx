import { surfaceAttributes } from "../../shared/ui/Surface";
import { Button } from "../../shared/ui/Button";
import { Badge, type BadgeTone } from "../../shared/ui/Badge";
import { Text } from "../../shared/ui/Text";
import { LiveText } from "../../shared/ui/LiveText";
import { t } from "../../shared/i18n";
import styles from "./DesktopControlStrip.module.css";
import { InlineError } from "../../shared/ui/InlineError";
type StripState = "stopping" | "unknown" | "stopped" | "working" | "ready" | "off";
const STATE_TONE: Record<StripState, BadgeTone> = {
  stopping: "warning",
  unknown: "warning",
  stopped: "neutral",
  working: "accent",
  ready: "success",
  off: "neutral",
};
function stateOf({
  stopping,
  unknown,
  status,
}: {
  stopping: boolean;
  unknown: boolean;
  status?: DesktopIndicatorStatus;
}): StripState {
  if (stopping) return "stopping";
  if (unknown) return "unknown";
  if (status?.stopped) return "stopped";
  if (status?.active) return "working";
  return status?.enabled ? "ready" : "off";
}
/** One literal translation per action id, so every label stays extractable. */
function operationLabel(action: string): string {
  switch (action) {
    case "click":
      return t("Click");
    case "double-click":
      return t("Double click");
    case "right-click":
      return t("Right click");
    case "set-value":
      return t("Set value");
    case "clear":
      return t("Clear");
    case "type":
      return t("Type text");
    case "select":
      return t("Select");
    case "check":
      return t("Check");
    case "uncheck":
      return t("Uncheck");
    case "toggle":
      return t("Toggle");
    case "expand":
      return t("Expand");
    case "collapse":
      return t("Collapse");
    case "scroll-to":
      return t("Scroll");
    case "focus":
      return t("Focus");
    case "press":
      return t("Keyboard shortcut");
    case "launch":
      return t("Launching app");
    case "clipboard-get":
      return t("Reading clipboard");
    case "clipboard-set":
      return t("Writing clipboard");
    case "clipboard-clear":
      return t("Clearing clipboard");
    default:
      return t("Activity");
  }
}
export type DesktopIndicatorStatus = {
  enabled: boolean;
  active: boolean;
  stopped: boolean;
  currentAction?: { app: string; action: string };
};
/** Shared content only. Native controller owns source, polling and Stop authority. */
export function DesktopControlStripView({
  name,
  status,
  notice = "",
  stopping = false,
  unknown = false,
  forceVisible = false,
  floating = false,
  onStop,
  onDismiss,
}: {
  name?: string;
  status?: DesktopIndicatorStatus;
  notice?: string;
  stopping?: boolean;
  unknown?: boolean;
  forceVisible?: boolean;
  floating?: boolean;
  onStop: () => void;
  onDismiss?: () => void;
}) {
  if (!forceVisible && !status?.enabled && !status?.active && !notice && !stopping) return null;
  const action = !unknown && !stopping ? status?.currentAction : undefined;
  const app =
    action?.action.startsWith("clipboard-") && action.app === "Global clipboard"
      ? t("Global clipboard")
      : action?.app;
  const operation = action ? operationLabel(action.action) : "";
  const state = stateOf({ stopping, unknown, status });
  const stateLabel = {
    stopping: t("Stopping…"),
    unknown: t("Status unavailable"),
    stopped: t("Stopped"),
    working: t("Working"),
    ready: t("Ready"),
    off: t("Off"),
  }[state];
  const label = `${name ? `${name} · ` : ""}${t("Computer use")} · ${stateLabel}${action ? ` · ${app} · ${operation}` : ""}`;
  const inactive = !!status && !status.enabled && !status.active && !unknown && !stopping;
  return (
    <Text
      as="aside"
      size="caption"
      tone="secondary"
      leading="inherit"
      {...surfaceAttributes(
        {
          frame: "pane",
          edge: floating ? "all" : "block-end",
          variant: floating ? "floating" : undefined,
          radius: floating ? "card" : undefined,
        },
        `${styles.strip} ${floating ? styles.floating : ""}`,
      )}
      aria-label={t("Computer controls")}
    >
      <span
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
        data-tauri-drag-region={floating ? "" : undefined}
      >
        <Text as="span" size="inherit" tone="primary" weight="medium" truncate>
          {name ? `${name} · ` : ""}
          {t("Computer use")}
        </Text>
        <Badge variant="dot" size="xs" tone={STATE_TONE[state]}>
          {stateLabel}
        </Badge>
        {action ? (
          <Text as="span" size="inherit" tone="muted" truncate>
            {app} · {operation}
          </Text>
        ) : null}
      </span>
      <LiveText className="sr-only" text={label} />
      {notice && <InlineError className={styles.notice}>{notice}</InlineError>}
      {inactive && onDismiss ? (
        <Button size="sm" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
      ) : state === "stopped" ? null : (
        <Button
          size="sm"
          tone="danger"
          loading={stopping}
          loadingLabel={t("Stopping…")}
          onClick={onStop}
        >
          {t("Stop computer use")}
        </Button>
      )}
    </Text>
  );
}
