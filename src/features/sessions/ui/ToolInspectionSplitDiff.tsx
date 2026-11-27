import { parseSplitDiff, type SplitCell } from "../model/toolDiffSplit";
import { surfaceAttributes, type SurfaceAppearance } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import styles from "./ToolInspectionSplitDiff.module.css";

const NUMBER_CLASS = `${styles.number} text-(--transcript-ink-faint)`;

function Cell({ cell, divided }: { cell: SplitCell | null; divided?: boolean }) {
  // The second column carries the hairline between the two sides.
  const edge: SurfaceAppearance = divided ? { frame: "pane", edge: "inline-start" } : {};
  if (!cell)
    return (
      <div
        {...surfaceAttributes(
          { ...edge, variant: "inset", radius: "none" },
          `${styles.cell} ${styles.empty}`,
        )}
        aria-hidden="true"
      >
        <span className={NUMBER_CLASS} />
        <span className={styles.code} />
      </div>
    );
  const variant =
    cell.tone === "add" ? "diff-add" : cell.tone === "del" ? "diff-delete" : undefined;
  return (
    <div {...surfaceAttributes({ ...edge, variant }, styles.cell)}>
      <span className={NUMBER_CLASS} aria-hidden="true">
        {cell.number}
      </span>
      <span className={styles.code}>{cell.text}</span>
    </div>
  );
}

/** Old on the left, new on the right; added and removed runs are paired so hunks stay aligned. */
export function ToolInspectionSplitDiff({ text, wrap }: { text: string; wrap: boolean }) {
  const rows = parseSplitDiff(text);
  return (
    <Text
      as="div"
      family="mono"
      size="caption"
      tone="inherit"
      leading="relaxed"
      className={`${styles.split} ${wrap ? "" : styles.nowrap} text-(--transcript-ink-body)`}
      data-split-diff
    >
      {rows.map((row, index) =>
        row.kind === "meta" ? (
          <Text
            {...surfaceAttributes(
              { tone: "neutral" },
              `${styles.meta} text-(--transcript-ink-faint)`,
            )}
            as="div"
            key={index}
            size="inherit"
            tone="inherit"
            leading="inherit"
            truncate
          >
            {row.text}
          </Text>
        ) : (
          <div key={index} className={styles.row}>
            <Cell cell={row.left} />
            <Cell cell={row.right} divided />
          </div>
        ),
      )}
    </Text>
  );
}
