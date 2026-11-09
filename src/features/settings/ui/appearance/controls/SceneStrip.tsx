import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useDecorativeMotionEnabled } from "../../../model/decorativeMotion";
import {
  LIVE_BACKGROUNDS,
  liveBackgroundLabel,
  type LiveBackground,
} from "../../../model/liveBackground";
import { LiveBackgroundCanvas } from "../../LiveBackgroundCanvas";
import { liveBackgroundKeyTarget } from "../../LiveBackgroundPicker";
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
  const [visible, setVisible] = useState(false);
  const selectedIndex = Math.max(0, LIVE_BACKGROUNDS.indexOf(value));

  useEffect(() => {
    const element = groupRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
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
    setPlaying(null);
  }, [motionEnabled]);

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

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = liveBackgroundKeyTarget(event.key, index, LIVE_BACKGROUNDS.length);
    const next = target === null ? undefined : LIVE_BACKGROUNDS[target];
    if (target === null || next === undefined) return;
    event.preventDefault();
    onChange(next);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[target]?.focus({
      preventScroll: true,
    });
  };

  return (
    <div className={styles.wrap}>
      {/* ui-drift-ignore: raw-role-radiogroup -- bespoke scene tiles preview on pointer enter and focus, which RadioTileGroup does not forward; arrows, Home and End move the choice via liveBackgroundKeyTarget */}
      <div ref={groupRef} role="radiogroup" aria-label={label} className={styles.grid}>
        {LIVE_BACKGROUNDS.map((scene, index) => {
          const name = liveBackgroundLabel(scene);
          return (
            <Button
              key={scene}
              variant="item"
              motion="none"
              selected={index === selectedIndex}
              type="button"
              role="radio"
              aria-checked={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
              tooltip={name}
              tooltipWhen="overflow"
              onClick={() => onChange(scene)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onPointerEnter={() => preview(scene)}
              onFocus={() => preview(scene)}
              className={styles.tile}
            >
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
            </Button>
          );
        })}
      </div>
    </div>
  );
}
