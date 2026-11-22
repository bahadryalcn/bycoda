import { useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { Button } from "../../../shared/ui/Button";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { ChartBreakoutSquare, Maximize2 } from "../../../shared/ui/icons";
import { ListRow } from "../../../shared/ui/ListRow";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Popover } from "../../../shared/ui/Popover";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Text } from "../../../shared/ui/Text";
import { blockLifecycle } from "../model/activityDock";
import { commandText, inspectCommand } from "../model/commandInspection";
import type { Block } from "../model/session";

const statusLabels = {
  running: "Working",
  done: "Completed",
  failed: "Failed",
  stopped: "Cancelled",
  interrupted: "Unknown",
} as const;

const emptyOutput = {
  running: "Running. No output has been reported yet; new output appears here.",
  done: "Finished. The command reported no output.",
  failed: "Failed without reporting output.",
  stopped: "Stopped before it reported any output.",
  interrupted: "Interrupted before it reported any output. Its final state was not reported.",
} as const;

type WorkProps = {
  tools: readonly Block[];
  busy: boolean;
  onOpenLiveWork?: () => void;
};

export function SessionWorkSummary({ tools, busy, onOpenLiveWork }: WorkProps) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const label = t("Work summary");
  return (
    <>
      <Button
        iconOnly
        variant="ghost"
        label={label}
        aria-haspopup="dialog"
        expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <ChartBreakoutSquare className="icon-sm" />
      </Button>
      {anchor ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          width={440}
          kind="dialog"
          aria-label={label}
          onDismiss={() => setAnchor(null)}
          flow="scroll"
        >
          <SessionWorkResultList
            tools={tools}
            busy={busy}
            onOpenLiveWork={
              onOpenLiveWork
                ? () => {
                    setAnchor(null);
                    anchor.focus({ preventScroll: true });
                    onOpenLiveWork();
                  }
                : undefined
            }
          />
        </Popover>
      ) : null}
    </>
  );
}

export function SessionWorkResultList({
  tools,
  busy,
  onOpenLiveWork,
  renderSelected,
}: WorkProps & { renderSelected?: (block: Block) => ReactNode }) {
  const t = useT();
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string>();
  const rows = [...tools].reverse().map((block) => ({
    block,
    title: commandText(block).text,
    status: blockLifecycle(block, busy),
  }));
  const search = query.trim().toLocaleLowerCase();
  const shown = rows.filter(
    (row) =>
      (status === "all" || row.status === status) &&
      (!search || row.title.toLocaleLowerCase().includes(search)),
  );
  const selected = shown.find(({ block }) => block.id === pickedId) ?? shown[0];
  const result = selected && !renderSelected && inspectCommand(selected.block, busy);
  const output = result ? [result.error, result.output].filter(Boolean).join("\n\n") : "";
  const preview = truncateGraphemes(output, 6000);

  return (
    <div className="grid gap-2 p-3">
      {rows.length > 1 && (
        <>
          <SearchInput
            type="search"
            appearance="field"
            aria-label={t("Search")}
            placeholder={t("Search")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <SegmentedControl
            size="sm"
            value={status}
            label={t("Filter")}
            onValueChange={setStatus}
            options={[
              { value: "all", label: t("All") },
              ...Object.entries(statusLabels)
                .filter(([value]) => value === status || rows.some((row) => row.status === value))
                .map(([value, label]) => ({ value, label: t(label) })),
            ]}
          />
        </>
      )}
      {shown.length ? (
        <div className="grid">
          {shown.map(({ block, title, status: lifecycle }) => (
            <ListRow
              key={block.id}
              selected={selected?.block.id === block.id}
              aria-pressed={selected?.block.id === block.id}
              onClick={() => setPickedId(block.id)}
              trailing={
                <Text as="span" size="caption" tone="secondary">
                  {t(statusLabels[lifecycle])}
                </Text>
              }
            >
              <Text as="span" truncate>
                {title}
              </Text>
            </ListRow>
          ))}
        </div>
      ) : (
        <Text tone="secondary">{t("No results")}</Text>
      )}
      {selected && renderSelected?.(selected.block)}
      {result && (
        <>
          {preview ? (
            <OutputBlock frame="filled" tone={result.error ? "danger" : "secondary"}>
              {preview}
            </OutputBlock>
          ) : result.remote ? null : (
            <Text tone="secondary">
              {t(
                result.outputTruncated
                  ? "The output was shortened and nothing is retained here, so it cannot be shown."
                  : emptyOutput[result.lifecycle],
              )}
            </Text>
          )}
          {result.remote && (
            <Text tone="secondary">{t("Only a summary of this output is kept here.")}</Text>
          )}
          {preview && (result.outputTruncated || preview !== output) && (
            <Text tone="secondary">
              {t("Output was shortened; the full text may not be available.")}
            </Text>
          )}
        </>
      )}
      {(output || onOpenLiveWork) && (
        <div className="flex flex-wrap justify-end gap-2">
          {output && <CopyButton key={selected?.block.id} label={t("Copy output")} text={output} />}
          {onOpenLiveWork && (
            <Button startIcon={<Maximize2 className="icon-sm" />} onClick={onOpenLiveWork}>
              {t("View live work")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
