import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { Download, ExternalLink, Pause, Play } from "../../../shared/ui/icons";
import { loadPeaks, PEAK_BARS } from "./mediaPeaks";
import { playbackText } from "./mediaPlayback";
import { ScrubBar } from "./ScrubBar";
import { seekMedia, togglePlayback, useMediaState } from "./useMediaState";
import styles from "./MediaPlayer.module.css";

/** Waveform heights for `path`: null until decoded, and for good when it cannot be. */
function useWaveform(path: string, url: string): number[] | null {
  const [loaded, setLoaded] = useState<{ path: string; peaks: number[] | null }>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads the decoded waveform for this source from the peaks cache, ignoring a reply after the source changed.
  useEffect(() => {
    // Decodes this source once (cached by path) and ignores a reply after the source changed.
    let current = true;
    void loadPeaks(path, url).then((peaks) => {
      if (current) setLoaded({ path, peaks });
    });
    return () => {
      current = false;
    };
  }, [path, url]);
  return loaded?.path === path ? loaded.peaks : null;
}

function Bars({ peaks, className }: { peaks: number[] | null; className: string }) {
  const heights = peaks ?? Array.from({ length: PEAK_BARS }, () => 0.3);
  return (
    <div className={className} aria-hidden>
      {heights.map((height, index) => (
        <i key={index} style={peaks ? ({ "--h": height } as CSSProperties) : undefined} />
      ))}
    </div>
  );
}

/**
 * Compact audio card: play or pause, a waveform that is also the seek control, the time, and
 * download or open. The `<audio>` element has no native controls and is the playback source.
 */
export function InlineAudio({
  path,
  url,
  label,
  playerRef,
  onFailed,
  onPlay,
  onOpen,
}: {
  path: string;
  url: string;
  label: string;
  playerRef: (element: HTMLMediaElement | null) => void;
  onFailed: () => void;
  onPlay: (element: HTMLMediaElement) => void;
  onOpen?: () => void;
}) {
  const t = useT();
  const [element, setElement] = useState<HTMLAudioElement | null>(null);
  // A stable ref callback: a new one each render would re-run and set state in a loop.
  const attach = useStableCallback((node: HTMLAudioElement | null) => {
    setElement(node);
    playerRef(node);
  });
  const wave = useRef<HTMLDivElement | null>(null);
  const { playing, duration, second } = useMediaState(element, wave);
  const peaks = useWaveform(path, url);
  const name = path.split(/[\\/]/).pop() || label;
  const time = `${playbackText(second)} / ${playbackText(duration)}`;
  const neutral = peaks ? "" : ` ${styles.neutral}`;
  return (
    <div className={styles.audio} data-playing={playing ? "" : undefined}>
      <audio
        ref={attach}
        src={url}
        preload="metadata"
        aria-label={label}
        onError={onFailed}
        onPlay={(event) => onPlay(event.currentTarget)}
      />
      <Button
        variant="primary"
        iconOnly
        size="lg"
        shape="pill"
        label={playing ? t("Pause") : t("Play")}
        className={styles.play}
        onClick={() => togglePlayback(element)}
      >
        {playing ? (
          <Pause className="icon-sm" aria-hidden />
        ) : (
          <Play className="icon-sm" aria-hidden />
        )}
      </Button>
      <div className={styles.main}>
        <div className={styles.top}>
          <OverflowTooltip label={name}>
            <Text
              truncate
              size="caption"
              tone="inherit"
              className={`${styles.name} text-(--transcript-ink-chrome)`}
            >
              {name}
            </Text>
          </OverflowTooltip>
          <Text
            size="caption"
            tone="inherit"
            className={`${styles.time} text-(--transcript-ink-chrome)`}
          >
            {time}
          </Text>
        </div>
        <ScrubBar
          ref={wave}
          label={t("Seek in {p0}", { p0: name })}
          value={second}
          max={duration}
          step={5}
          valueText={time}
          className={styles.wave}
          onChange={(value) => {
            seekMedia(element, value);
          }}
        >
          <Bars peaks={peaks} className={styles.bars + neutral} />
          <Bars peaks={peaks} className={`${styles.bars} ${styles.played}${neutral}`} />
        </ScrubBar>
      </div>
      <div className={styles.actions}>
        {onOpen ? (
          <Button variant="ghost" iconOnly label={t("Open")} onClick={onOpen}>
            <ExternalLink className="icon-sm" aria-hidden />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          iconOnly
          label={t("Download")}
          onClick={() => {
            // The native file URL downloads under the file's own name.
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.click();
          }}
        >
          <Download className="icon-sm" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
