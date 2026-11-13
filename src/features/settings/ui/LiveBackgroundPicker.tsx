import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { radioKeyTarget } from "../../../shared/lib/radioKeyTarget";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { useLocale } from "../../../shared/i18n";
import { LiveBackgroundCanvas } from "./LiveBackgroundCanvas";
import {
  LIVE_BACKGROUNDS,
  liveBackgroundLabel,
  type LiveBackground,
} from "../model/liveBackground";

/** Index reached by a radio-group key, or null when the key is not a navigation key. */
export const liveBackgroundKeyTarget = radioKeyTarget;

/** The scene `delta` steps away, wrapping at both ends. */
export function stepLiveBackground(value: LiveBackground, delta: number): LiveBackground {
  const index = Math.max(0, LIVE_BACKGROUNDS.indexOf(value));
  const count = LIVE_BACKGROUNDS.length;
  return LIVE_BACKGROUNDS[(((index + delta) % count) + count) % count] ?? value;
}

/**
 * Radio group of evenly sized scene tiles. Only the selected tile is a tab stop; arrow keys,
 * Home and End move focus and select together, like a native radio group. The selected tile plays
 * its scene live (the picker's own preview); the others stay still.
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
  return (
    <RadioGroup
      variant="tiles"
      label={label}
      value={value}
      className="grid w-full grid-cols-[repeat(auto-fill,5.5rem)] justify-start gap-2"
      tileClassName="flex min-w-0 flex-col gap-1"
      tile={{ motion: "none", tooltipWhen: "overflow" }}
      options={LIVE_BACKGROUNDS.map((scene) => ({
        value: scene,
        tooltip: liveBackgroundLabel(scene),
        content: <LiveBackgroundTileContent scene={scene} selected={scene === value} />,
      }))}
      onValueChange={(next) => onChange(next as LiveBackground)}
    />
  );
}

function LiveBackgroundTileContent({
  scene,
  selected,
}: {
  scene: LiveBackground;
  selected: boolean;
}) {
  const label = liveBackgroundLabel(scene);
  const ref = useRef<HTMLSpanElement>(null);
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
    <>
      <span
        ref={ref}
        {...surfaceAttributes(
          { radius: "row", variant: "base" },
          "relative block aspect-square w-full overflow-hidden",
        )}
      >
        {visible && scene !== "none" ? (
          <LiveBackgroundCanvas
            effect={scene}
            intensity={1}
            still={!selected}
            demoSpeech
            className="absolute inset-0"
          />
        ) : null}
      </span>
      <Text size="micro" tone="inherit" truncate className="px-0.5">
        {label}
      </Text>
    </>
  );
}
