import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useT } from "../../../shared/i18n";
import { AnsiText } from "../../../shared/ui/AnsiText";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { logLines } from "./fileViews";
import styles from "./FileViews.module.css";

const ROW = 20;

/**
 * A `.log` file with its terminal colors kept and a line-number gutter. Rows are virtual, so a log of
 * hundreds of thousands of lines scrolls like a short one. Color escapes apply within their own line.
 */
export function LogFileView({ text, visible }: { text: string; visible: boolean }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const lines = visible ? logLines(text) : [];
  // oxlint-disable-next-line react-hooks-js/incompatible-library -- TanStack Virtual returns unstable function identities, so the compiler skips this row list.
  const virtual = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 30,
  });
  const gutter = String(lines.length).length;
  const inset = { variant: "inset", radius: "none" } as const;
  return (
    <Text
      {...surfaceAttributes(inset, styles.log)}
      as="div"
      ref={scroller}
      size="caption"
      tone="primary"
      family="mono"
      leading="none"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable log must take focus so the keyboard can scroll it
      tabIndex={0}
      role="region"
      aria-label={t("Log")}
      style={{ "--log-gutter": `${gutter}ch` } as React.CSSProperties}
    >
      <div
        className={styles.logRows}
        style={{ "--log-height": `${virtual.getTotalSize()}px` } as React.CSSProperties}
      >
        {virtual.getVirtualItems().map((item) => (
          <div
            key={item.key}
            className={styles.logLine}
            style={{ "--log-y": `${item.start}px` } as React.CSSProperties}
          >
            <Text
              {...surfaceAttributes(inset, styles.logNumber)}
              tone="muted"
              size="inherit"
              leading="inherit"
              aria-hidden="true"
            >
              {item.index + 1}
            </Text>
            <span className={styles.logText}>
              <AnsiText text={lines[item.index] ?? ""} />
            </span>
          </div>
        ))}
      </div>
    </Text>
  );
}
