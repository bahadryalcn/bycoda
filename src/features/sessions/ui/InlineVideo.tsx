import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "../../../shared/ui/icons";
import { playbackText } from "./mediaPlayback";
import { ScrubBar } from "./ScrubBar";
import {
  seekMedia,
  setMediaVolume,
  toggleMuted,
  togglePlayback,
  useMediaState,
} from "./useMediaState";
import styles from "./MediaPlayer.module.css";

/**
 * Video with quiet chrome in place of the native controls: a centered play button, and a
 * bottom bar with play or pause, a seek bar, the time, mute with a volume bar, and full
 * screen. The bar hides while playing until the pointer or focus is inside.
 */
export function InlineVideo({
  url,
  label,
  playerRef,
  onFailed,
  onPlay,
  onMetadata,
}: {
  url: string;
  label: string;
  playerRef: (element: HTMLMediaElement | null) => void;
  onFailed: () => void;
  onPlay: (element: HTMLMediaElement) => void;
  onMetadata: (size: { width: number; height: number }) => void;
}) {
  const t = useT();
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  // A stable ref callback: a new one each render would re-run and set state in a loop.
  const attach = useStableCallback((node: HTMLVideoElement | null) => {
    setElement(node);
    playerRef(node);
  });
  const frame = useRef<HTMLDivElement | null>(null);
  const seek = useRef<HTMLDivElement | null>(null);
  const { playing, duration, second, muted, volume } = useMediaState(element, seek);
  const [fullscreen, setFullscreen] = useState(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- listens to the document's fullscreenchange event while mounted.
  useEffect(() => {
    // Tracks whether this frame is the fullscreen element, however it was entered or left.
    const sync = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const time = `${playbackText(second)} / ${playbackText(duration)}`;
  const level = muted ? 0 : volume;
  return (
    <div ref={frame} className={styles.video} data-playing={playing ? "" : undefined}>
      <video
        ref={attach}
        src={url}
        playsInline
        preload="metadata"
        aria-label={label}
        onClick={() => togglePlayback(element)}
        onLoadedMetadata={(event) =>
          onMetadata({
            width: event.currentTarget.videoWidth,
            height: event.currentTarget.videoHeight,
          })
        }
        onError={onFailed}
        onPlay={(event) => onPlay(event.currentTarget)}
      />
      <Button
        variant="secondary"
        iconOnly
        label={t("Play")}
        className={styles.big}
        tabIndex={playing ? -1 : 0}
        onClick={() => togglePlayback(element)}
      >
        <Play className="icon-md" aria-hidden />
      </Button>
      <div className={styles.bar}>
        <Button
          variant="ghost"
          iconOnly
          label={playing ? t("Pause") : t("Play")}
          onClick={() => togglePlayback(element)}
        >
          {playing ? (
            <Pause className="icon-sm" aria-hidden />
          ) : (
            <Play className="icon-sm" aria-hidden />
          )}
        </Button>
        <ScrubBar
          ref={seek}
          label={t("Seek in {p0}", { p0: label })}
          value={second}
          max={duration}
          step={5}
          valueText={time}
          className={styles.seek}
          onChange={(value) => {
            seekMedia(element, value);
          }}
        >
          <span className={styles.fill} />
          <span className={styles.knob} />
        </ScrubBar>
        <Text size="micro" tone="inherit" className={`${styles.vtime} opacity-90`}>
          {time}
        </Text>
        <Button
          variant="ghost"
          iconOnly
          label={muted ? t("Unmute") : t("Mute")}
          onClick={() => {
            toggleMuted(element);
          }}
        >
          {muted ? (
            <VolumeX className="icon-sm" aria-hidden />
          ) : (
            <Volume2 className="icon-sm" aria-hidden />
          )}
        </Button>
        <ScrubBar
          label={t("Volume")}
          value={level}
          max={1}
          step={0.1}
          valueText={`${Math.round(level * 100)}%`}
          className={styles.volume}
          onChange={(value) => {
            setMediaVolume(element, value);
          }}
        >
          <span className={styles.fill} style={{ "--p": level } as CSSProperties} />
        </ScrubBar>
        {document.fullscreenEnabled ? (
          <Button
            variant="ghost"
            iconOnly
            label={fullscreen ? t("Exit full screen") : t("Full screen")}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
              else void frame.current?.requestFullscreen().catch(() => undefined);
            }}
          >
            {fullscreen ? (
              <Minimize2 className="icon-sm" aria-hidden />
            ) : (
              <Maximize2 className="icon-sm" aria-hidden />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
