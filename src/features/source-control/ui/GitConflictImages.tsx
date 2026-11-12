import { Text } from "../../../shared/ui/Text";
import { useMemo, useState } from "react";
import type { GitConflictStages } from "../../../platform/tauri/fs";
import { formatFileSize } from "../../../shared/i18n/format";
import { t, useLocale } from "../../../shared/i18n/git";
import { conflictImage, type StageSide } from "../model/conflictCompare";

const SIDE_LABEL: Record<StageSide, string> = {
  base: "Base",
  ours: "Current",
  theirs: "Incoming",
};

// Icons and sprites this small are scaled up with hard pixel edges so the two
// versions can be told apart; larger images keep smooth scaling.
const PIXELATED_MAX = 128;

type Props = {
  stages: GitConflictStages;
  sides: [StageSide, StageSide];
};

/** Two versions of a conflicted image side by side, read-only. */
export function GitConflictImages({ stages, sides }: Props) {
  useLocale();
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-stroke">
      {sides.map((side) => (
        <ImageSide key={side} stages={stages} side={side} />
      ))}
    </div>
  );
}

function ImageSide({ stages, side }: { stages: GitConflictStages; side: StageSide }) {
  const image = useMemo(() => conflictImage(stages, side), [stages, side]);
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const size = image.status === "image" && natural?.src === image.src ? natural : null;
  const label = t(SIDE_LABEL[side]);
  return (
    <figure className="m-0 flex min-h-0 min-w-0 flex-col">
      <Text
        as="figcaption"
        tone="inherit"
        className="flex shrink-0 items-center gap-2 border-b border-stroke px-4 py-1.5"
      >
        <Text as="span" size="inherit" tone="primary" weight="medium">
          {label}
        </Text>
        {image.status === "image" ? (
          <Text size="inherit" tone="muted" className="tabular-nums">
            {size ? `${size.w} × ${size.h} · ` : ""}
            {formatFileSize(image.bytes)}
          </Text>
        ) : null}
      </Text>
      {image.status === "image" ? (
        <div
          className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4"
          style={{
            backgroundImage: "var(--ui-transparency-grid-image)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 8px 8px",
          }}
        >
          <img
            src={image.src}
            alt={label}
            draggable={false}
            onLoad={(event) =>
              setNatural({
                src: image.src,
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            className="h-full max-h-full w-full max-w-full object-contain"
            style={
              size && Math.max(size.w, size.h) <= PIXELATED_MAX
                ? { imageRendering: "pixelated" }
                : size
                  ? { width: "auto", height: "auto" }
                  : undefined
            }
          />
        </div>
      ) : (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          className="grid flex-1 place-items-center p-6 text-center"
        >
          {image.status === "missing"
            ? t("No version on this side")
            : t("This version can’t be shown as an image")}
        </Text>
      )}
    </figure>
  );
}
