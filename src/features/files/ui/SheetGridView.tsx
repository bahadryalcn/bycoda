import { t, useLocale } from "../../../shared/i18n/technical";
import { useId, useState, useRef, useEffect, useLayoutEffect } from "react";
import type { SparseSheet } from "../model/spreadsheet";
import { formatInteger } from "../../../shared/lib/numbers";
import { DocumentMessage } from "./DocumentMessage";
import { useAnchoredZoom } from "./documentZoom";
import { ZoomBadge } from "./ZoomBadge";
const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 24;
const ROW_HEADER_WIDTH = 56;
const COLUMN_WIDTH = 120;
const FONT_SIZE = 12;
const CELL_PADDING = 8;
const OVERSCAN = 10;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function SheetGridView({ grid }: { grid: SparseSheet }) {
  useLocale();
  const name = grid.name;
  const id = useId();
  const [focused, setFocused] = useState({ row: 0, column: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const empty = grid.columns.length === 0 || grid.rowCount === 0;
  const { zoom, reset } = useAnchoredZoom(scrollRef, "sheet", {
    min: MIN_ZOOM,
    max: MAX_ZOOM,
    active: !empty,
  });
  // The grid is virtualized by row height, so zoom scales the row height, the
  // column widths and the font together rather than transforming the container.
  const rowHeight = Math.round(ROW_HEIGHT * zoom);
  const headerHeight = Math.round(HEADER_HEIGHT * zoom);
  const rowHeaderWidth = Math.round(ROW_HEADER_WIDTH * zoom);
  const columnWidth = Math.round(COLUMN_WIDTH * zoom);
  const cellStyle = {
    width: columnWidth,
    lineHeight: `${rowHeight}px`,
    paddingInline: CELL_PADDING * zoom,
  };

  // The anchored scroll lands in a layout effect; sync the windowing state
  // with it so the first painted frame already shows the right rows.
  useLayoutEffect(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, [zoom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: 0, left: 0 });
    setScrollTop(0);
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    setViewport(element.clientHeight);
    return () => observer.disconnect();
  }, [name]);

  if (empty) {
    return <DocumentMessage title={t("This sheet is empty")} />;
  }

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(grid.rowCount, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
  const width = rowHeaderWidth + grid.columns.length * columnWidth;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {grid.truncated ? (
        <div className="shrink-0 border-b border-stroke bg-(--ui-surface-muted) px-3 py-1 text-ui-micro text-[var(--ui-text-secondary)]">
          {t("Showing the first ")}
          {formatInteger(grid.rowCount)}
          {t(" of")} {formatInteger(grid.totalRows)}
          {t(" rows and")} {formatInteger(grid.columns.length)}
          {t(" of")} {formatInteger(grid.totalColumns)}
          {t(" columns.")}
          {grid.budgetLimited
            ? t(
                " Cell/text preview budget reached; some values are omitted or shortened. Open the original file to see all values.",
              )
            : ""}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        role="grid"
        aria-label={t("{p0}, read-only spreadsheet", { p0: name })}
        aria-readonly="true"
        aria-rowcount={grid.rowCount + 1}
        aria-colcount={grid.columns.length + 1}
        aria-activedescendant={`${id}-cell-${focused.row}-${focused.column}`}
        tabIndex={0}
        onKeyDown={(event) => {
          let { row, column } = focused;
          if (event.key === "ArrowDown") row++;
          else if (event.key === "ArrowUp") row--;
          else if (event.key === "ArrowRight") column++;
          else if (event.key === "ArrowLeft") column--;
          else if (event.key === "Home") {
            column = 0;
            if (event.ctrlKey) row = 0;
          } else if (event.key === "End") {
            column = grid.columns.length - 1;
            if (event.ctrlKey) row = grid.rowCount - 1;
          } else if (event.key === "PageDown")
            row += Math.max(1, Math.floor(viewport / rowHeight) - 1);
          else if (event.key === "PageUp") row -= Math.max(1, Math.floor(viewport / rowHeight) - 1);
          else return;
          event.preventDefault();
          row = Math.max(0, Math.min(grid.rowCount - 1, row));
          column = Math.max(0, Math.min(grid.columns.length - 1, column));
          setFocused({ row, column });
          const element = event.currentTarget;
          const top = row * rowHeight;
          if (top < element.scrollTop) element.scrollTop = top;
          else if (top + rowHeight > element.scrollTop + element.clientHeight - headerHeight)
            element.scrollTop = top + rowHeight - element.clientHeight + headerHeight;
          const left = column * columnWidth;
          if (left < element.scrollLeft) element.scrollLeft = left;
          else if (left + columnWidth > element.scrollLeft + element.clientWidth - rowHeaderWidth)
            element.scrollLeft = left + columnWidth - element.clientWidth + rowHeaderWidth;
          setScrollTop(element.scrollTop);
        }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto overscroll-contain select-text"
        style={{ fontSize: FONT_SIZE * zoom }}
      >
        <div
          className="relative"
          style={{
            width,
            height: headerHeight + grid.rowCount * rowHeight,
          }}
        >
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-20 flex border-b border-stroke bg-[var(--ui-surface)] text-[var(--ui-text-secondary)]"
            style={{
              height: headerHeight,
              width,
              lineHeight: `${rowHeight}px`,
            }}
          >
            <div
              role="columnheader"
              aria-colindex={1}
              aria-label={t("Row")}
              className="sticky left-0 z-10 shrink-0 border-r border-stroke bg-[var(--ui-surface)]"
              style={{ width: rowHeaderWidth }}
            />
            {grid.columns.map((label, column) => (
              <div
                key={label}
                role="columnheader"
                aria-colindex={column + 2}
                className="shrink-0 border-r border-stroke text-center"
                style={{ width: columnWidth }}
              >
                {label}
              </div>
            ))}
          </div>
          {Array.from(
            new Set([
              ...Array.from({ length: last - first }, (_, offset) => first + offset),
              focused.row,
            ]),
          )
            .sort((a, b) => a - b)
            .map((index) => {
              return (
                <div
                  key={index}
                  role="row"
                  aria-rowindex={index + 2}
                  className="absolute left-0 flex border-b border-stroke/60"
                  style={{
                    top: headerHeight + index * rowHeight,
                    height: rowHeight,
                    width,
                  }}
                >
                  <div
                    role="rowheader"
                    aria-colindex={1}
                    className="sticky left-0 z-10 shrink-0 border-r border-stroke bg-[var(--ui-surface)] text-right text-[var(--ui-text-secondary)] tabular-nums"
                    style={{
                      width: rowHeaderWidth,
                      lineHeight: `${rowHeight}px`,
                      paddingRight: CELL_PADDING * zoom,
                    }}
                  >
                    {index + 1}
                  </div>
                  {grid.columns.map((_, column) => {
                    const cell = grid.cells[`${index}:${column}`] ?? "";
                    return (
                      <div
                        key={column}
                        role="gridcell"
                        aria-colindex={column + 2}
                        id={`${id}-cell-${index}-${column}`}
                        aria-label={`${grid.columns[column]}${index + 1}: ${cell || "empty"}`}
                        aria-selected={focused.row === index && focused.column === column}
                        onClick={() => {
                          setFocused({ row: index, column });
                          scrollRef.current?.focus();
                        }}
                        title={cell}
                        className="shrink-0 truncate border-r border-stroke/60 text-content"
                        style={{
                          ...cellStyle,
                          outline:
                            focused.row === index && focused.column === column
                              ? "2px solid var(--color-accent, currentColor)"
                              : undefined,
                          outlineOffset: -2,
                        }}
                      >
                        {cell}
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </div>
      </div>
      <ZoomBadge zoom={zoom} onReset={reset} />
    </div>
  );
}
