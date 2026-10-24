import { Button } from "../../../shared/ui/Button";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "../../../shared/i18n";
import { LiveBackgroundCanvas } from "./LiveBackgroundCanvas";
import {
  LIVE_BACKGROUNDS,
  liveBackgroundLabel,
  type LiveBackground,
} from "../model/liveBackground";

/** Index reached by a radio-group key, or null when the key is not a navigation key. */
export function liveBackgroundKeyTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The scene `delta` steps away, wrapping at both ends (used by the preview's previous/next). */
export function stepLiveBackground(value: LiveBackground, delta: number): LiveBackground {
  const index = Math.max(0, LIVE_BACKGROUNDS.indexOf(value));
  const count = LIVE_BACKGROUNDS.length;
  return LIVE_BACKGROUNDS[(((index + delta) % count) + count) % count] ?? value;
}

/**
 * Radio group of scene tiles. Only the selected tile is a tab stop; arrow keys,
 * Home and End move focus and select together, like a native radio group.
 */
export function LiveBackgroundPicker({
  value,
  onChange,
  label,
}: {
  value: LiveBackground;
  onChange: (value: LiveBackground) => void;
  label: string;
}) {
  useLocale();
  const groupRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, LIVE_BACKGROUNDS.indexOf(value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = liveBackgroundKeyTarget(event.key, index, LIVE_BACKGROUNDS.length);
    const next = target === null ? undefined : LIVE_BACKGROUNDS[target];
    if (target === null || next === undefined) return;
    event.preventDefault();
    onChange(next);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [target]?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2"
    >
      {LIVE_BACKGROUNDS.map((option, index) => (
        <LiveBackgroundTile
          key={option}
          scene={option}
          selected={index === selectedIndex}
          tabStop={index === selectedIndex}
          onSelect={() => onChange(option)}
          onKeyDown={(event) => onKeyDown(event, index)}
        />
      ))}
    </div>
  );
}

function LiveBackgroundTile({
  scene,
  selected,
  tabStop,
  onSelect,
  onKeyDown,
}: {
  scene: LiveBackground;
  selected: boolean;
  tabStop: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const label = liveBackgroundLabel(scene);
  const ref = useRef<HTMLButtonElement>(null);
  // Thumbnails paint once the tile nears the viewport and then stay painted.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (visible || !element) return;
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
  }, [visible]);

  return (
    <Button
      variant="item"
      motion="none"
      selected={selected}
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabStop ? 0 : -1}
      title={label}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-1"
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-background-base">
        {visible && scene !== "none" ? (
          <LiveBackgroundCanvas
            effect={scene}
            intensity={1}
            still
            demoSpeech
            className="absolute inset-0"
          />
        ) : null}
      </span>
      <span className="truncate px-0.5 text-ui-micro leading-4">{label}</span>
    </Button>
  );
}
