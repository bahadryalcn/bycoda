import { useState } from "react";
import {
  ImageCompare as ArcImageCompare,
  type ImageCompareProps,
} from "./arc/image-compare/image-compare";
import { useT } from "../i18n";
import { MediaToolbar, MediaToolbarButton } from "./MediaToolbar";
import { Maximize2, SplitSquare } from "./icons";

export type BycodaImageCompareProps = ImageCompareProps & {
  /** Adds the shared media toolbar (orientation, reset divider) under the frame. Off by default. */
  toolbar?: boolean;
  /** Tone of the optional toolbar: `overlay` on a media backdrop, `surface` on a pane. */
  toolbarTone?: "overlay" | "surface";
};

/**
 * Before/after slider over two images, horizontal or vertical; the optional `toolbar` adds orientation toggle
 * and a centre-divider reset.
 * @group media
 * @status internal
 */
export function ImageCompare({
  toolbar = false,
  toolbarTone = "overlay",
  ...props
}: BycodaImageCompareProps) {
  const t = useT();
  const [orientation, setOrientation] = useState(props.orientation ?? "horizontal");
  const [position, setPosition] = useState(props.defaultPosition ?? 50);
  const frame = (extra: Partial<ImageCompareProps>) => (
    <ArcImageCompare
      label={t("Compare images")}
      labels={[t("Before"), t("After")]}
      {...props}
      {...extra}
      className={["bycoda-arc bycoda-arc-image-compare", props.className].filter(Boolean).join(" ")}
    />
  );
  if (!toolbar) return frame({});
  const orient = props.orientation ?? orientation;
  const place = props.position ?? position;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <div className="min-h-0 min-w-0 flex-1">
        {frame({
          orientation: orient,
          position: place,
          defaultPosition: undefined,
          onPositionChange: (next) => {
            setPosition(next);
            props.onPositionChange?.(next);
          },
        })}
      </div>
      <MediaToolbar label={t("Comparison tools")} tone={toolbarTone} className="justify-center">
        <MediaToolbarButton
          tone={toolbarTone}
          label={orient === "vertical" ? t("Compare side by side") : t("Compare stacked")}
          onClick={() => setOrientation(orient === "vertical" ? "horizontal" : "vertical")}
        >
          <SplitSquare
            className={`icon-sm ${orient === "vertical" ? "rotate-90" : ""}`}
            aria-hidden
          />
        </MediaToolbarButton>
        <MediaToolbarButton
          tone={toolbarTone}
          label={t("Center divider")}
          disabled={Math.abs(place - 50) < 0.5}
          onClick={() => {
            setPosition(50);
            props.onPositionChange?.(50);
          }}
        >
          <Maximize2 className="icon-sm" aria-hidden />
        </MediaToolbarButton>
      </MediaToolbar>
    </div>
  );
}
