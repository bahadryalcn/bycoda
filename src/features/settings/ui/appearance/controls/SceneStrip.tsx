import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../../../../shared/i18n";
import { RadioGroup } from "../../../../../shared/ui/RadioGroup";
import { useDecorativeMotionEnabled } from "../../../model/decorativeMotion";
import {
  LIVE_BACKGROUNDS,
  liveBackgroundLabel,
  type LiveBackground,
} from "../../../model/liveBackground";
import { LiveBackgroundCanvas } from "../../LiveBackgroundCanvas";
import styles from "./SceneStrip.module.css";

const PREVIEW_MS = 4000;

/** Radio selection with a short, optional preview on pointer or keyboard focus. */
export function SceneStrip({
  value,
  onChange,
  label,
}: {
  value: LiveBackground;
  onChange: (value: LiveBackground) => void;
  label: string;
}) {
  useLocale();
  const motionEnabled = useDecorativeMotionEnabled();
  const groupRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState<LiveBackground | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = groupRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "160px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (motionEnabled) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, [motionEnabled]);
  // Motion turned off while a preview plays: drop it so it does not return when motion does.
  if (!motionEnabled && playing !== null) setPlaying(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const preview = (scene: LiveBackground) => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (!motionEnabled || scene === "none") {
      setPlaying(null);
      return;
    }
    setPlaying(scene);
    timer.current = setTimeout(() => {
      setPlaying(null);
      timer.current = null;
    }, PREVIEW_MS);
  };

  return (
    <div ref={groupRef} className={styles.wrap}>
      <RadioGroup
        variant="tiles"
        label={label}
        value={value}
        onValueChange={(scene) => onChange(scene as LiveBackground)}
        onOptionIntent={(scene) => preview(scene as LiveBackground)}
        className={styles.grid}
        tileClassName={styles.tile}
        tile={{ motion: "none", tooltipWhen: "overflow" }}
        options={LIVE_BACKGROUNDS.map((scene) => {
          const name = liveBackgroundLabel(scene);
          return {
            value: scene,
            ariaLabel: name,
            tooltip: name,
            content: (
              <>
                <span className={styles.thumb}>
                  {visible && scene !== "none" ? (
                    <LiveBackgroundCanvas
                      effect={scene}
                      intensity={1}
                      still={!motionEnabled || playing !== scene}
                      demoSpeech
                      className="absolute inset-0"
                    />
                  ) : null}
                </span>
                <span className="w-full line-clamp-2 whitespace-normal px-0.5 text-ui-micro leading-4">
                  {name}
                </span>
              </>
            ),
          };
        })}
      />
    </div>
  );
}
