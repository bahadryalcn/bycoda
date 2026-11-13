import "./SheetGridView.css";
import type { CSSProperties } from "react";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useId, useState, useRef, useEffect, useLayoutEffect } from "react";
import type { SparseSheet } from "../model/spreadsheet";
import { useFormat } from "../../../shared/i18n";
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

export function SheetGridView({
  grid,
  fitContent = false,
}: {
  grid: SparseSheet;
  fitContent?: boolean;
}) {
  useLocale();
  const format = useFormat();
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
    <div
      className={`relative flex min-h-0 flex-col ${fitContent ? "" : "flex-1"}`}
      style={
        fitContent
          ? { height: headerHeight + grid.rowCount * rowHeight, maxHeight: "min(560px,60dvh)" }
          : undefined
      }
    >
      {grid.truncated ? (
        <Text
          as="div"
          size="micro"
          tone="secondary"
          {...surfaceAttributes({ frame: "stroke", edge: "bottom" }, "shrink-0 px-3 py-1")}
        >
          {t("Showing the first ")}
          {format.formatNumber(grid.rowCount, { maximumFractionDigits: 0 })}
          {t(" of")} {format.formatNumber(grid.totalRows, { maximumFractionDigits: 0 })}
          {t(" rows and")} {format.formatNumber(grid.columns.length, { maximumFractionDigits: 0 })}
          {t(" of")} {format.formatNumber(grid.totalColumns, { maximumFractionDigits: 0 })}
          {t(" columns.")}
          {grid.budgetLimited
            ? t(
                " Cell/text preview budget reached; some values are omitted or shortened. Open the original file to see all values.",
              )
            : ""}
        </Text>
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
        className="sheet-document-viewport min-h-0 flex-1 overflow-auto overscroll-contain select-text"
        style={
          {
            "--document-font-size": `${FONT_SIZE * zoom}px`,
            "--document-row-height": `${rowHeight}px`,
            "--document-header-height": `${headerHeight}px`,
            "--document-row-header-width": `${rowHeaderWidth}px`,
            "--document-column-width": `${columnWidth}px`,
            "--document-cell-padding": `${CELL_PADDING * zoom}px`,
            "--document-width": `${width}px`,
            "--document-height": `${headerHeight + grid.rowCount * rowHeight}px`,
          } as CSSProperties
        }
      >
        <div className="sheet-document-body relative isolate">
          <Text
            role="row"
            aria-rowindex={1}
            as="div"
            size="inherit"
            tone="secondary"
            {...surfaceAttributes(
              { frame: "stroke", edge: "bottom", variant: "base" },
              "sheet-document-header sticky top-0 z-2 flex",
            )}
          >
            <div
              role="columnheader"
              aria-colindex={1}
              aria-label={t("Row")}
              {...surfaceAttributes(
                { frame: "stroke", edge: "right", variant: "base" },
                "sticky left-0 z-1 shrink-0 [width:var(--layout-width)]",
              )}
              style={
                {
                  "--layout-width":
                    rowHeaderWidth === undefined ? undefined : rowHeaderWidth + "px",
                } as CSSProperties
              }
            />
            {grid.columns.map((label, column) => (
              <div
                key={label}
                role="columnheader"
                aria-colindex={column + 2}
                {...surfaceAttributes(
                  { frame: "stroke", edge: "right" },
                  "shrink-0 text-center [width:var(--layout-width)]",
                )}
                style={
                  {
                    "--layout-width": columnWidth === undefined ? undefined : columnWidth + "px",
                  } as CSSProperties
                }
              >
                {label}
              </div>
            ))}
          </Text>
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
                  {...surfaceAttributes(
                    { frame: "stroke", edge: "bottom" },
                    "sheet-document-row absolute left-0 flex",
                  )}
                  style={
                    {
                      "--document-row-top": `${headerHeight + index * rowHeight}px`,
                    } as CSSProperties
                  }
                >
                  <Text
                    role="rowheader"
                    aria-colindex={1}
                    as="div"
                    size="inherit"
                    tone="secondary"
                    {...surfaceAttributes(
                      { frame: "stroke", edge: "right", variant: "base" },
                      "sheet-document-row-header sticky left-0 z-1 shrink-0 text-right tabular-nums",
                    )}
                  >
                    {index + 1}
                  </Text>
                  {grid.columns.map((_, column) => {
                    const cell = grid.cells[`${index}:${column}`] ?? "";
                    return (
                      <Text
                        truncate
                        key={column}
                        role="gridcell"
                        aria-colindex={column + 2}
                        id={`${id}-cell-${index}-${column}`}
                        aria-label={`${grid.columns[column]}${index + 1}: ${cell || t("Empty cell")}`}
                        aria-selected={focused.row === index && focused.column === column}
                        onClick={() => {
                          setFocused({ row: index, column });
                          scrollRef.current?.focus();
                        }}
                        as="div"
                        size="inherit"
                        tone="primary"
                        {...surfaceAttributes(
                          { frame: "stroke", edge: "right", selectionRing: "document" },
                          "sheet-document-cell shrink-0",
                        )}
                      >
                        <OverflowTooltip label={cell}>
                          <Text size="inherit" tone="inherit" truncate className="block">
                            {cell}
                          </Text>
                        </OverflowTooltip>
                      </Text>
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
