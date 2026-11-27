import type { ReactNode } from "react";
import { Button } from "./Button";
import { Text } from "./Text";
import styles from "./StatTile.module.css";

export type StatTileProps = {
  /** What is counted: one to three words. */
  label: string;
  /** The figure, already formatted (`formatNumber`, `formatPercent`). */
  value: ReactNode;
  /** Makes the whole tile one action (open what the figure counts). */
  onOpen?: () => void;
  /** With `onOpen`: the tile is a toggle in a single-select group; sets `aria-pressed` and the selected look. */
  selected?: boolean;
  /** Extra line under the figure, such as a Meter. */
  children?: ReactNode;
};

/**
 * One stat inside a StatRow: caption label above a medium figure; a button when `onOpen` is set.
 * @group data
 * @use One headline figure with its label inside StatRow, optionally opening what it counts.
 * @avoid Standalone use outside StatRow, or a figure in running text: Text.
 */
export function StatTile({ label, value, onOpen, selected, children }: StatTileProps) {
  const body = (
    <>
      <Text size="caption" tone="muted" leading="inherit">
        {label}
      </Text>
      <Text
        as="span"
        size="heading"
        tone="primary"
        weight="medium"
        leading="tight"
        className={styles.value}
      >
        {value}
      </Text>
      {children}
    </>
  );
  return onOpen ? (
    <Button
      variant="item"
      layout="stacked"
      align="start"
      className={styles.tile}
      onClick={onOpen}
      pressed={selected}
    >
      {body}
    </Button>
  ) : (
    <div className={styles.tile}>{body}</div>
  );
}

/**
 * A row of stats on the canvas: hairline above and below, hairline dividers between tiles, no card fill.
 * @group data
 * @use Two to four headline figures at the top of a screen (sent today, waiting, done today); wrap `StatTile`s.
 * @avoid A figure inside a sentence or table: Text. A figure with a chart: Charts. Grouped facts about one item: DescriptionList. A gray card per figure: never, the canvas carries it.
 *
 * @example
 * <StatRow label={t("Today")}>
 *   <StatTile label={t("Waiting")} value={formatNumber(3)} onOpen={openWaiting} />
 *   <StatTile label={t("Done today")} value={formatNumber(8)} />
 * </StatRow>
 */
export function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={styles.row}>
      {children}
    </div>
  );
}
