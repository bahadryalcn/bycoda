import { surfaceAttributes } from "../../shared/ui/Surface";
import { Button } from "../../shared/ui/Button";
import { ClampText } from "../../shared/ui/ClampText";
import { Text } from "../../shared/ui/Text";
import { t } from "../../shared/i18n";
import styles from "./DesktopControlStrip.module.css";
import { InlineError } from "../../shared/ui/InlineError";
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
  error = "",
  stopping = false,
  unknown = false,
  forceVisible = false,
  floating = false,
  onStop,
  onDismiss,
}: {
  name?: string;
  status?: DesktopIndicatorStatus;
  error?: string;
  stopping?: boolean;
  unknown?: boolean;
  forceVisible?: boolean;
  floating?: boolean;
  onStop: () => void;
  onDismiss?: () => void;
}) {
  if (!forceVisible && !status?.enabled && !status?.active && !error && !stopping) return null;
  const action = !unknown && !stopping ? status?.currentAction : undefined;
  const app =
    action?.action.startsWith("clipboard-") && action.app === "Global clipboard"
      ? t("Global clipboard")
      : action?.app;
  const operation = action
    ? t(
        (
          {
            click: "Click",
            "double-click": "Double click",
            "right-click": "Right click",
            "set-value": "Set value",
            clear: "Clear",
            type: "Type",
            select: "Select",
            check: "Check",
            uncheck: "Uncheck",
            toggle: "Toggle",
            expand: "Expand",
            collapse: "Collapse",
            "scroll-to": "Scroll",
            focus: "Focus",
            press: "Keyboard shortcut",
            launch: "Launching app",
            "clipboard-get": "Reading clipboard",
            "clipboard-set": "Writing clipboard",
            "clipboard-clear": "Clearing clipboard",
          } as Record<string, string>
        )[action.action] ?? "Activity",
      )
    : "";
  const label = `${name ? `${name} · ` : ""}${t("Computer use")} · ${t(stopping ? "Stopping..." : unknown ? "Status unavailable" : status?.stopped ? "Stopped" : status?.active ? "Working" : status?.enabled ? "Ready" : "Off")}${action ? ` · ${app} · ${operation}` : ""}`;
  const inactive = !!status && !status.enabled && !status.active && !unknown && !stopping;
  return (
    <Text
      as="aside"
      size="caption"
      tone="secondary"
      leading="inherit"
      {...surfaceAttributes(
        {
          frame: "neutral",
          edge: floating ? "all" : "block-end",
          variant: floating ? "plain" : undefined,
          radius: floating ? "card" : undefined,
        },
        `${styles.strip} ${floating ? styles.floating : ""}`,
      )}
      aria-label={t("Computer controls")}
    >
      {floating ? (
        <ClampText
          as="span"
          lines={2}
          expandable={false}
          size="inherit"
          tone="inherit"
          role="status"
          data-tauri-drag-region
        >
          {label}
        </ClampText>
      ) : (
        <Text as="span" size="inherit" tone="inherit" role="status">
          {label}
        </Text>
      )}
      {error && <InlineError className={styles.error}>{error}</InlineError>}
      {inactive && onDismiss ? (
        <Button size="sm" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
      ) : (
        <Button size="sm" tone="danger" loading={stopping} onClick={onStop}>
          {t("Stop computer use")}
        </Button>
      )}
    </Text>
  );
}
