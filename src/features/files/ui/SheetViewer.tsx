import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useEffect, useId, useMemo, useState } from "react";
import { documentErrorMessage } from "../model/documentViewer";
import { loadSpreadsheet } from "../model/spreadsheetClient";
import type { Spreadsheet } from "../model/spreadsheet";
import { DocumentMessage } from "./DocumentMessage";
import { SheetGridView } from "./SheetGridView";

type State =
  | { status: "loading" }
  | { status: "ready"; book: Spreadsheet }
  | { status: "error"; message: string };
type SourceState = { source: object; state: State };

export default function SheetViewer({
  bytes,
  format,
  fitContent = false,
}: {
  bytes: Uint8Array;
  format?: "csv" | "tsv";
  fitContent?: boolean;
}) {
  useLocale();
  // State belongs to the bytes/format it was produced from, so a new source starts
  // from loading and the first sheet without a reset effect.
  const source = useMemo(() => ({}), [bytes, format]);
  const [loaded, setLoaded] = useState<SourceState | null>(null);
  const [chosen, setChosen] = useState<{ source: object; index: number } | null>(null);
  const state: State = loaded && loaded.source === source ? loaded.state : { status: "loading" };
  const active = chosen && chosen.source === source ? chosen.index : 0;
  const setActive = (index: number) => setChosen({ source, index });
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    loadSpreadsheet(bytes, controller.signal, undefined, undefined, format).then(
      (book) => {
        if (!controller.signal.aborted) setLoaded({ source, state: { status: "ready", book } });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setLoaded({
            source,
            state: { status: "error", message: documentErrorMessage(cause) },
          });
      },
    );
    return () => controller.abort();
  }, [bytes, format, source]);

  if (state.status === "loading") {
    return (
      <div role="status" className="ui-secondary-text grid h-full place-items-center">
        {t("Reading spreadsheet…")}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <DocumentMessage title={t("Couldn’t read this spreadsheet")} error>
        {state.message}
      </DocumentMessage>
    );
  }
  const names = state.book.sheets.map((sheet) => sheet.name);
  if (names.length === 0) {
    return <DocumentMessage title={t("This workbook has no sheets")} />;
  }
  return (
    <div className={`flex min-h-0 flex-col ${fitContent ? "" : "h-full"}`}>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={names.length > 1 ? `${id}-tab-${active}` : undefined}
        aria-label={names.length === 1 ? names[0] : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SheetGridView key={active} grid={state.book.sheets[Math.min(active, names.length - 1)]} fitContent={fitContent} />
      </div>
      {state.book.omittedSheets > 0 ? (
        <p role="status" className="px-3 text-ui-caption text-(--ui-text-secondary)">
          {t("Only the first 100 sheets are previewed.")}
        </p>
      ) : null}
      {names.length > 1 ? (
        <div
          role="tablist"
          aria-label={t("Workbook sheets")}
          className="flex min-h-(--ui-control-height-compact) shrink-0 items-center gap-1 overflow-x-auto border-t border-(--ui-pane-border) px-2 py-1 text-ui-caption"
        >
          {names.map((name, index) => (
            <Button
              size="sm"
              selected={index === active}
              variant="tab"
              motion="none"
              key={name}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel`}
              tabIndex={index === active ? 0 : -1}
              aria-selected={index === active}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight") next = (index + 1) % names.length;
                else if (event.key === "ArrowLeft")
                  next = (index + names.length - 1) % names.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = names.length - 1;
                else return;
                event.preventDefault();
                setActive(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }}
              onClick={() => setActive(index)}
              className={"shrink-0"}
            >
              {name}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
