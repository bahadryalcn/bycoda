import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import * as technicalI18n from "../../../shared/i18n/technical";
import { useVisibleNow } from "../hooks/useVisibleNow";
import type { DeviceFrame } from "../types";

const { dateTimeFormat, getLocale, relativeTimeFormat, t, useLocale } = technicalI18n;

/** Full capture date and time for the pill's hint; undefined when the Host sent no real timestamp. */
function capturedTitle(capturedAt: string | undefined): string | undefined {
  const at = capturedAt ? Date.parse(capturedAt) : NaN;
  if (!Number.isFinite(at)) return undefined;
  try {
    return dateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "medium" }).format(at);
  } catch {
    return undefined;
  }
}

/** How long a live view may go without a new frame before it reads as refreshing. */
const LIVE_FRAME_DELAY_MS = 3000;

/** Readable capture time and age for a retained frame; undefined when the Host sent no real timestamp. */
export function capturedLabel(capturedAt: string, now: number): string | undefined {
  const at = Date.parse(capturedAt);
  if (!Number.isFinite(at)) return undefined;
  let locale: string | undefined;
  try {
    locale = getLocale();
    dateTimeFormat(locale);
  } catch {
    locale = undefined;
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const relative = relativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  const age =
    seconds < 2
      ? relative.format(0, "second")
      : seconds < 60
        ? relative.format(-seconds, "second")
        : seconds < 3600
          ? relative.format(-Math.round(seconds / 60), "minute")
          : relative.format(-Math.round(seconds / 3600), "hour");
  const time = dateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
  return t("Captured {p0} · {p1}", { p0: time, p1: age });
}

type DeviceFrameStateProps = {
  /** The retained live frame; the delayed-live check reads its capture time. */
  frame: DeviceFrame;
  /** The frame the stage shows, which is the frozen draft frame while marking. */
  shownFrame: DeviceFrame | undefined;
  live: boolean;
  streaming: boolean;
  /** Whether the panel is on screen; a hidden panel keeps no timer. */
  visible: boolean;
  annotating: boolean;
  frameStale: boolean;
  captureFailed: boolean;
  connectionUnavailable: boolean;
};

/**
 * The pill that says the stage is not live and how old the picture is. It owns the clock that
 * ages the label, so the per-second tick re-renders only this leaf and never the device panel.
 */
export function DeviceFrameState({
  frame,
  shownFrame,
  live,
  streaming,
  visible,
  annotating,
  frameStale,
  captureFailed,
  connectionUnavailable,
}: DeviceFrameStateProps) {
  useLocale();
  const now = useVisibleNow(visible && !streaming, live ? 1000 : 5000);
  const liveFrameDelayed =
    live &&
    !streaming &&
    Number.isFinite(Date.parse(frame.capturedAt)) &&
    now - Date.parse(frame.capturedAt) >= LIVE_FRAME_DELAY_MS;
  const stateVisible =
    !live || annotating || frameStale || captureFailed || connectionUnavailable || liveFrameDelayed;
  if (!stateVisible) return null;
  const captured = shownFrame ? capturedLabel(shownFrame.capturedAt, now) : undefined;
  return (
    <Tooltip label={capturedTitle(shownFrame?.capturedAt)} asChild>
      <Text
        truncate
        size="micro"
        tone="primary"
        leading="inherit"
        {...surfaceAttributes(
          { variant: "floating", frame: "pane", radius: "pill", elevation: "floating" },
          "device-panel-frame-state",
        )}
      >
        {annotating
          ? t("Marking · Frozen frame")
          : captureFailed || connectionUnavailable || frameStale
            ? t("Last frame · Not live")
            : liveFrameDelayed
              ? t("Last frame · Refreshing")
              : t("Paused")}
        {captured ? ` · ${captured}` : ""}
      </Text>
    </Tooltip>
  );
}
