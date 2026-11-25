import { EmptyState } from "../../../shared/ui/EmptyState";
import { useState } from "react";
import { formatNumber, t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { ArrowUp, ArrowDown } from "../../../shared/ui/icons";
import type { DecisionSource } from "../model/decisionTypes";
import { moveSource, sourceOptions } from "../model/routingEditor";
import { SourceKindIcon } from "./SourceIcon";

const SEARCH_FROM = 8;

/** Membership and fallback order share one keyboard-accessible popover. */
export function SourceOrderPicker({
  label,
  value,
  sources,
  disabled,
  onChange,
}: {
  label: string;
  value: readonly string[];
  sources: DecisionSource[];
  disabled: boolean;
  onChange: (value: readonly string[]) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  // A handful of sources needs no search; the popover closes on outside click or Escape.
  const searchable = sources.length > SEARCH_FROM;
  const ordered = sourceOptions(value, sources, searchable ? search : "");
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        align="start"
        label={label}
        aria-label={label}
        aria-haspopup="dialog"
        expanded={anchor !== null}
        disabled={disabled}
        disabledReason={disabled ? t("Wait for the current change to finish.") : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <span className="flex min-w-0 items-center gap-1">
          {value.length
            ? value.map((id, index) => {
                const source = sources.find((item) => item.id === id);
                return (
                  <Badge
                    key={id}
                    size="xs"
                    truncate
                    icon={
                      source ? (
                        <SourceKindIcon
                          kind={source.kind}
                          modelPath={source.local?.modelPath}
                          compact
                        />
                      ) : undefined
                    }
                  >
                    {formatNumber(index + 1)} {source?.name ?? id}
                  </Badge>
                );
              })
            : t("Automatic")}
        </span>
      </Button>
      {anchor ? (
        <Popover
          anchor={anchor}
          kind="dialog"
          aria-label={label}
          variant="panel"
          width={400}
          flow="scroll"
          onDismiss={() => setAnchor(null)}
        >
          <div className="flex flex-col gap-2">
            {searchable ? (
              <TextField
                label={t("Search sources")}
                hideLabel
                placeholder={t("Search sources")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            ) : null}
            {ordered.map((id) => {
              const source = sources.find((item) => item.id === id);
              const index = value.indexOf(id);
              return (
                <div key={id} className="flex min-w-0 items-center justify-between gap-2">
                  <Checkbox
                    disabled={disabled}
                    disabledReason={
                      disabled ? t("Wait for the current change to finish.") : undefined
                    }
                    checked={index >= 0}
                    onChange={() =>
                      onChange(index >= 0 ? value.filter((item) => item !== id) : [...value, id])
                    }
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        {source ? (
                          <SourceKindIcon
                            compact
                            kind={source.kind}
                            modelPath={source.local?.modelPath}
                          />
                        ) : null}
                        <Text size="body" truncate>
                          {index >= 0 ? `${formatNumber(index + 1)} ` : ""}
                          {source?.name ?? id}
                        </Text>
                      </span>
                    }
                  />
                  {index >= 0 ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        label={t("Move up")}
                        disabled={disabled || index === 0}
                        disabledReason={
                          disabled
                            ? t("Wait for the current change to finish.")
                            : t("Already first.")
                        }
                        onClick={() => onChange(moveSource(value, id, -1))}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        label={t("Move down")}
                        disabled={disabled || index === value.length - 1}
                        disabledReason={
                          disabled
                            ? t("Wait for the current change to finish.")
                            : t("Already last.")
                        }
                        onClick={() => onChange(moveSource(value, id, 1))}
                      >
                        <ArrowDown />
                      </Button>
                    </span>
                  ) : null}
                </div>
              );
            })}
            {!ordered.length ? (
              <EmptyState
                size="inline"
                kind={search.trim() ? "filtered" : "empty"}
                description={search.trim() ? t("No results") : t("No sources connected")}
                onReset={search.trim() ? () => setSearch("") : undefined}
                resetLabel={t("Clear search")}
              />
            ) : null}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
